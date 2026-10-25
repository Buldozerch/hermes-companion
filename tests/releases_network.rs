//! Optional live smoke check for the release discovery used by both update buttons.
use hermes_core::{Result, releases};

#[tokio::test]
#[ignore = "Requires access to the public GitHub releases API"]
async fn release_discovery_reads_the_official_public_endpoints() -> Result<()> {
    let hermes = releases::discover(false).await?;
    assert!(hermes.is_some());
    if let Some(release) = hermes {
        assert!(releases::version(&release.tag_name)?.pre.is_empty());
    }
    if let Some(release) = releases::discover(true).await? {
        assert!(!release.draft);
        releases::version(&release.tag_name)?;
    }
    Ok(())
}
