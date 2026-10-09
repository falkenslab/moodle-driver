/**
 * A grader panel reduced to its submission status table, as Moodle 5.2 renders it: online text
 * with a summary and a full block, a short online text with only a summary, files, and comments.
 * Made up; no real submission.
 */
export const PANEL = `<div class="submissionstatustable"><h3>Submission</h3>
<div class="assignsubmission assignsubmission_onlinetext">
  <div class="box plugincontentsummary summary_assignsubmission_onlinetext_8">
    <a class="expandsummaryicon expand_assignsubmission_onlinetext_8" aria-label="View full" href=""><i class="icon"></i></a>(40 words) First paragraph…
  </div>
  <div class="box hidefull full_assignsubmission_onlinetext_8">
    <a class="expandsummaryicon contract_assignsubmission_onlinetext_8" aria-label="View summary" href=""><i class="icon"></i></a>
    <div class="no-overflow"><p>First   paragraph, with <code>x = 1</code>.</p><p>Second<br>line &amp; more.</p><ul><li>one</li><li>two</li></ul></div>
  </div>
</div>
<div class="box plugincontentsummary summary_assignsubmission_file_8">
  <div class="fileuploadsubmission"><a href="http://moodle.test/pluginfile.php/17/assignsubmission_file/submission_files/8/essay.pdf?forcedownload=1">essay.pdf</a></div>
</div>
<div class="box plugincontentsummary summary_assignsubmission_onlinetext_9"><div class="no-overflow"><p>Short answer.</p></div></div>
<div class="box plugincontentsummary summary_assignsubmission_comments_8"><a href="#">Comments (0)</a></div>
</div>`;
