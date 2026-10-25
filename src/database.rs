use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};

use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

use crate::{
    Activity, AppError, HostKeyStatus, Result, Server, ServerDraft, ServerReport, SetupOptions,
    models::now,
};

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS servers (
               id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL,
               port INTEGER NOT NULL, username TEXT NOT NULL, report TEXT, setup TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS known_hosts (
               host TEXT NOT NULL, port INTEGER NOT NULL, fingerprint TEXT NOT NULL,
               PRIMARY KEY (host, port)
             );
             CREATE TABLE IF NOT EXISTS activity (
               id TEXT PRIMARY KEY, server_id TEXT, title TEXT NOT NULL,
               detail TEXT NOT NULL, level TEXT NOT NULL, created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS deployment_jobs (
               server_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, state TEXT NOT NULL,
               FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
             );",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>> {
        self.connection.lock().map_err(|_| {
            AppError::new(
                "storage",
                "Storage is temporarily unavailable. Restart the app.",
            )
        })
    }

    pub fn list_servers(&self) -> Result<Vec<Server>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id,name,host,port,username,report,setup FROM servers ORDER BY rowid DESC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u16>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        rows.map(|row| {
            let (id, name, host, port, username, report, setup) = row?;
            Ok(Server {
                id,
                connection: ServerDraft {
                    name,
                    host,
                    port,
                    username,
                },
                report: report.map(|json| serde_json::from_str(&json)).transpose()?,
                setup: {
                    let mut value: SetupOptions = serde_json::from_str(&setup)?;
                    value.normalize_legacy();
                    value
                },
            })
        })
        .collect()
    }

    pub fn server(&self, id: &str) -> Result<Server> {
        self.list_servers()?
            .into_iter()
            .find(|server| server.id == id)
            .ok_or_else(|| AppError::new("notFound", "Server not found. Refresh the server list."))
    }

    pub fn add_server(&self, connection: ServerDraft) -> Result<Server> {
        connection.validate()?;
        let server = Server {
            id: Uuid::new_v4().to_string(),
            connection,
            report: None,
            setup: SetupOptions::clean_install(true),
        };
        self.lock()?.execute(
            "INSERT INTO servers (id,name,host,port,username,setup) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                server.id,
                server.connection.name.trim(),
                server.connection.host.to_ascii_lowercase(),
                server.connection.port,
                server.connection.username,
                serde_json::to_string(&server.setup)?
            ],
        )?;
        self.record(
            Some(&server.id),
            "Server added",
            "Connection settings were saved on this device.",
            "info",
        )?;
        self.server(&server.id)
    }

    pub fn remove_server(&self, id: &str) -> Result<()> {
        self.lock()?
            .execute("DELETE FROM servers WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn known_fingerprint(&self, host: &str, port: u16) -> Result<Option<String>> {
        Ok(self
            .lock()?
            .query_row(
                "SELECT fingerprint FROM known_hosts WHERE host=?1 AND port=?2",
                params![host.to_ascii_lowercase(), port],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// A changed key cannot be silently replaced, including through a direct IPC call.
    pub fn trust_host(&self, host: &str, port: u16, fingerprint: &str) -> Result<()> {
        if !fingerprint.starts_with("SHA256:") || fingerprint.len() > 100 {
            return Err(AppError::new(
                "validation",
                "Invalid server key fingerprint.",
            ));
        }
        let connection = self.lock()?;
        let previous: Option<String> = connection
            .query_row(
                "SELECT fingerprint FROM known_hosts WHERE host=?1 AND port=?2",
                params![host.to_ascii_lowercase(), port],
                |r| r.get(0),
            )
            .optional()?;
        if previous.as_deref().is_some_and(|old| old != fingerprint) {
            return Err(AppError::new(
                "hostKeyChanged",
                "The server key changed. Connection blocked. Verify the server with your hosting provider.",
            ));
        }
        connection.execute(
            "INSERT OR IGNORE INTO known_hosts (host,port,fingerprint) VALUES (?1,?2,?3)",
            params![host.to_ascii_lowercase(), port, fingerprint],
        )?;
        Ok(())
    }

    pub fn host_status(&self, host: &str, port: u16, fingerprint: &str) -> Result<HostKeyStatus> {
        Ok(match self.known_fingerprint(host, port)? {
            None => HostKeyStatus::New,
            Some(old) if old == fingerprint => HostKeyStatus::Trusted,
            Some(_) => HostKeyStatus::Changed,
        })
    }

    pub fn save_report(&self, id: &str, report: &ServerReport) -> Result<()> {
        let changed = self.lock()?.execute(
            "UPDATE servers SET report=?1 WHERE id=?2",
            params![serde_json::to_string(report)?, id],
        )?;
        if changed == 0 {
            return Err(AppError::new(
                "notFound",
                "The server profile was removed while connecting.",
            ));
        }
        Ok(())
    }

    pub fn save_setup(&self, id: &str, setup: &SetupOptions) -> Result<()> {
        setup.validate()?;
        self.lock()?.execute(
            "UPDATE servers SET setup=?1 WHERE id=?2",
            params![serde_json::to_string(setup)?, id],
        )?;
        Ok(())
    }

    pub fn record(
        &self,
        server_id: Option<&str>,
        title: &str,
        detail: &str,
        level: &str,
    ) -> Result<()> {
        self.lock()?.execute("INSERT INTO activity (id,server_id,title,detail,level,created_at) VALUES (?1,?2,?3,?4,?5,?6)", params![Uuid::new_v4().to_string(),server_id,title,detail,level,i64::try_from(now()).unwrap_or(i64::MAX)])?;
        Ok(())
    }

    /// Persist the remote job reference and report terminal transitions once.
    pub fn observe_deployment(
        &self,
        server_id: &str,
        status: &crate::deployment::DeploymentStatus,
    ) -> Result<()> {
        use crate::deployment::JobState;
        let Some(job_id) = &status.job_id else {
            return Ok(());
        };
        let state = serde_json::to_string(&status.state)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let previous: Option<(String, String)> = transaction
            .query_row(
                "SELECT job_id,state FROM deployment_jobs WHERE server_id=?1",
                [server_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if previous
            .as_ref()
            .is_some_and(|previous| previous.0 == *job_id && previous.1 == state)
        {
            return Ok(());
        }
        transaction.execute("INSERT INTO deployment_jobs(server_id,job_id,state) VALUES (?1,?2,?3) ON CONFLICT(server_id) DO UPDATE SET job_id=excluded.job_id,state=excluded.state", params![server_id,job_id,state])?;
        let transition = match status.state {
            JobState::Succeeded if status.operation == "update" => Some((
                "Hermes updated",
                "Hermes was updated through the stable channel. Existing configuration and accounts were preserved.",
                "success",
            )),
            JobState::Failed | JobState::Interrupted if status.operation == "update" => Some((
                "Hermes update failed",
                "The update did not complete. Review the logs. A private pre-update backup is stored on the server.",
                "error",
            )),
            JobState::Succeeded if status.operation == "provider" => Some((
                "Provider support ready",
                "Antigravity support was prepared. Sign in and select a model before applying your provider settings.",
                "success",
            )),
            JobState::Failed | JobState::Interrupted if status.operation == "provider" => Some((
                "Provider preparation failed",
                "The optional provider job did not complete. Review the diagnostic logs before retrying.",
                "error",
            )),
            JobState::Succeeded if status.operation == "configure" => Some((
                "Settings applied",
                "Model, channel and tool settings were applied. Check the live service status.",
                "success",
            )),
            JobState::Failed if status.operation == "configure" => Some((
                "Settings failed",
                "The configuration job failed. Read the diagnostic logs before retrying.",
                "error",
            )),
            JobState::Interrupted if status.operation == "configure" => Some((
                "Settings interrupted",
                "The configuration job stopped before completion. Reconnect and apply settings again.",
                "error",
            )),
            JobState::Succeeded => Some((
                "Installation completed",
                "Hermes was installed. Check the live service status before using the agent.",
                "success",
            )),
            JobState::Failed => Some((
                "Installation failed",
                "The remote installation failed. Read the diagnostic logs before retrying.",
                "error",
            )),
            JobState::Interrupted => Some((
                "Installation interrupted",
                "The remote job stopped before completion. Reconnect and retry installation.",
                "error",
            )),
            _ => None,
        };
        if let Some((title, detail, level)) = transition {
            transaction.execute("INSERT INTO activity(id,server_id,title,detail,level,created_at) VALUES (?1,?2,?3,?4,?5,?6)", params![Uuid::new_v4().to_string(),server_id,title,detail,level,i64::try_from(now()).unwrap_or(i64::MAX)])?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn activity(&self) -> Result<Vec<Activity>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare("SELECT id,server_id,title,detail,level,created_at FROM activity ORDER BY rowid DESC LIMIT 200")?;
        Ok(statement
            .query_map([], |r| {
                Ok(Activity {
                    id: r.get(0)?,
                    server_id: r.get(1)?,
                    title: r.get(2)?,
                    detail: r.get(3)?,
                    level: r.get(4)?,
                    created_at: r.get::<_, i64>(5)?.max(0) as u64,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polling_a_finished_job_does_not_duplicate_activity() -> Result<()> {
        let db = Database::open(Path::new(":memory:"))?;
        let server = db.add_server(ServerDraft {
            name: "Test".into(),
            host: "example.com".into(),
            port: 22,
            username: "root".into(),
        })?;
        let status = crate::deployment::parse_status(
            "job_id=00000000-0000-4000-8000-000000000001\nstate=succeeded\n",
        )?;
        db.observe_deployment(&server.id, &status)?;
        db.observe_deployment(&server.id, &status)?;
        assert_eq!(
            db.activity()?
                .iter()
                .filter(|event| event.title == "Installation completed")
                .count(),
            1
        );
        Ok(())
    }

    #[test]
    fn changed_host_key_cannot_replace_trusted_key() -> Result<()> {
        let db = Database::open(Path::new(":memory:"))?;
        db.trust_host("host.example", 22, "SHA256:original")?;
        assert!(db.trust_host("HOST.EXAMPLE", 22, "SHA256:changed").is_err());
        assert_eq!(
            db.known_fingerprint("host.example", 22)?,
            Some("SHA256:original".into())
        );
        Ok(())
    }

    #[test]
    fn server_profiles_survive_reopening_database() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("test.db");
        let db = Database::open(&path)?;
        let saved = db.add_server(ServerDraft {
            name: "My Hermes".into(),
            host: "EXAMPLE.COM".into(),
            port: 22,
            username: "root".into(),
        })?;
        assert!(saved.setup.defer_model_setup);
        assert!(saved.setup.model.is_empty());
        saved.setup.validate()?;
        drop(db);
        let restored = Database::open(&path)?.server(&saved.id)?;
        assert_eq!(restored.connection.host, "example.com");
        assert!(restored.setup.defer_model_setup);
        assert!(restored.setup.model.is_empty());
        Ok(())
    }
}
