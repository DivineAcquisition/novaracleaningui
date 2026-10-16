-- Starting business identity from the service, host, and partner agreements.
-- Fills a blank postal address. An address the owner already saved is left alone.

UPDATE public.app_settings
SET value = value || jsonb_build_object(
  'legalName', 'Novara Cleaning LLC',
  'brandName', 'NovaraCleaning',
  'phone', '(844) 735-2070',
  'refundsEmail', 'refunds@novaracleaning.com',
  'refundPolicyUrl', 'https://novaracleaning.com/refund-policy',
  'cancellationPolicyUrl', 'https://novaracleaning.com/cancellation-policy',
  'mailingAddress', jsonb_build_object(
    'line1', '7404 Executive Place',
    'line2', '',
    'city', 'Lanham',
    'region', 'MD',
    'postalCode', '20706',
    'country', 'US'
  ),
  'supportEmail', 'support@novaracleaning.com',
  'monitoredInboxes', jsonb_build_array(
    'support@novaracleaning.com',
    'billing@novaracleaning.com',
    'refunds@novaracleaning.com',
    'operations@novaracleaning.com',
    'ops@novaracleaning.com'
  ),
  'why', jsonb_build_object(
    'customer_service', 'You are receiving this service message because of your booking or account with {{brand}}.',
    'customer_marketing', 'You are receiving this promotional email because {{reason}}.',
    'agreement_account', 'You are receiving this service message because of your booking or account with {{brand}}.',
    'contractor_operational', 'This message relates to your independent contractor relationship with {{legal}} under your Independent Contractor Agreement.',
    'contractor_tax', 'This message relates to your independent contractor relationship with {{legal}} under your Independent Contractor Agreement.',
    'internal_admin', 'Novara internal system notification. Not for customers or contractors.'
  ),
  'contractorOnBehalf', '{{contractor}}, on behalf of {{legal}}',
  'contractorRelationshipLine', 'This message relates to your independent contractor relationship with {{legal}} under your Independent Contractor Agreement.',
  'payoutTaxLine', 'No taxes were withheld from this payment. You are responsible for your own taxes.',
  'taxDocumentLine', 'Your Form 1099-NEC for {{taxYear}} is available through the secure link in this email. You are receiving it electronically because you consented on {{consentDate}}. {{paperCopy}} {{withdraw}} If anything looks wrong, reply within {{correctionDays}} days. This email does not include your full taxpayer ID.',
  'paperCopyLine', 'To request a paper copy, reply to this email.',
  'withdrawConsentLine', 'To withdraw your consent, reply to this email.',
  'serviceSafetyLine', 'We will never ask for your full card number, or for gate or alarm codes, by email.',
  'recordKeptLine', 'A copy of this message is kept in your account record.',
  'refundQuestionsLine', 'Refund questions: {{refunds}}',
  'partnerGovernsLine', 'Your agreement with {{legal}} governs this account.',
  'marketingStopLine', 'Unsubscribing stops promotional emails only. We will still send booking, payment and account messages.'
)
WHERE key = 'email_business_identity'
  AND coalesce(value #>> '{mailingAddress,line1}', '') = '';
