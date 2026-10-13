import { MoodleError } from "../../core/errors.js";

/** Moodle refused a copy, backup, restore or import, or didn't finish it in time; or a file isn't a Moodle backup the driver can read. */
export class BackupError extends MoodleError {
  override name = "BackupError";
  constructor(message: string) {
    super(message, "backup");
  }
}
