import { z } from "zod";
import { translate, type Translator } from "./i18n";

export const serverSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "What would you like to name this server?")
    .max(80, "Use no more than 80 characters"),
  host: z
    .string()
    .trim()
    .min(1, "Enter the server IP address")
    .max(253, "Use no more than 253 characters")
    .regex(/^[a-zA-Z0-9.:-]+$/, "Enter an IP address or domain without https:// or spaces")
    .refine((value) => !value.startsWith("-"), "Check the server address"),
  port: z
    .number({ error: "The port must be a whole number" })
    .int("The port must be a whole number")
    .min(1, "Use a port from 1 to 65535")
    .max(65535, "Use a port from 1 to 65535"),
  username: z
    .string()
    .min(1, "Enter the SSH username")
    .max(32, "Use no more than 32 characters")
    .regex(
      /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/,
      "Use only Latin letters, numbers, hyphens and underscores",
    ),
});

export function errorMessage(
  error: unknown,
  t: Translator = (message) => translate("en", message),
): string {
  if (typeof error === "string") return t(error);
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return t(error.message);
  return t("The action failed. Please try again.");
}
