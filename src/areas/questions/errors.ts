import { MoodleError } from "../../core/errors.js";

/** The bank isn't there, or Moodle refused the questions. */
export class QuestionBankError extends MoodleError {
  override name = "QuestionBankError";
  constructor(message: string) {
    super(message, "question-bank");
  }
}
