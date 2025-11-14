-- Rename twilio_sid to provider_message_id for provider flexibility
ALTER TABLE sms_logs 
RENAME COLUMN twilio_sid TO provider_message_id;

COMMENT ON COLUMN sms_logs.provider_message_id IS 'Message ID from SMS provider (MessageBird, Twilio, etc.)';