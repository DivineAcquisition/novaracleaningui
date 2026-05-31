-- Job Dispatch pipeline stage IDs (optional — auto-discovered by name when empty).
INSERT INTO public.app_secrets (key, value, description)
VALUES
  ('GHL_DISPATCH_PIPELINE_ID', '', 'GoHighLevel pipeline ID for Job Dispatch (bookings). When empty, matched by pipeline name "Job Dispatch".'),
  ('GHL_DISPATCH_STAGE_UNASSIGNED', '', 'Stage: Unassigned'),
  ('GHL_DISPATCH_STAGE_OFFERED', '', 'Stage: Offered'),
  ('GHL_DISPATCH_STAGE_ACCEPTED', '', 'Stage: Accepted'),
  ('GHL_DISPATCH_STAGE_DECLINED', '', 'Stage: Declined / No Response'),
  ('GHL_DISPATCH_STAGE_SCHEDULED', '', 'Stage: Scheduled'),
  ('GHL_DISPATCH_STAGE_IN_PROGRESS', '', 'Stage: In Progress'),
  ('GHL_DISPATCH_STAGE_COMPLETED', '', 'Stage: Completed'),
  ('GHL_DISPATCH_STAGE_VERIFIED', '', 'Stage: Verified'),
  ('GHL_DISPATCH_STAGE_PAID', '', 'Stage: Paid')
ON CONFLICT (key) DO NOTHING;
