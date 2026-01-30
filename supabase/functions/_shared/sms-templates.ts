/**
 * SMS Templates for Novara Cleaning
 * 
 * All messages should be under 160 characters when possible for single segment SMS
 * For longer messages, aim for under 320 characters (2 segments)
 */

export interface JobDetails {
  date: string;
  time: string;
  city: string;
  zip: string;
  address?: string;
  estimatedPay: string;
  duration: number;
  distance?: number;
}

export interface CleanerDetails {
  firstName: string;
  phone: string;
}

/**
 * Job offer SMS - sent when a new job is dispatched
 */
export function jobOfferSMS(job: JobDetails, responseUrl: string): string {
  return `🧹 NOVARA JOB OFFER

📅 ${job.date} at ${job.time}
📍 ${job.city}, ${job.zip}
💰 $${job.estimatedPay} (${job.duration}hrs)
${job.distance ? `🚗 ${job.distance} mi away\n` : ''}
Reply ACCEPT or DECLINE
Or tap: ${responseUrl}

⏰ Respond in 15 min`;
}

/**
 * Job accepted confirmation
 */
export function jobAcceptedSMS(job: JobDetails): string {
  return `✅ JOB CONFIRMED!

📅 ${job.date} at ${job.time}
📍 ${job.address || job.city}, ${job.zip}

Check app for details. Arrive 5 min early!

Questions? Reply HELP`;
}

/**
 * Job declined acknowledgment
 */
export function jobDeclinedSMS(): string {
  return `❌ Job declined. We'll send you more offers soon.

Reply STATUS to see your stats.`;
}

/**
 * Verification code SMS
 */
export function verificationCodeSMS(code: string, firstName?: string): string {
  const name = firstName ? ` ${firstName}` : '';
  return `Hi${name}! Your Novara verification code is: ${code}

This code expires in 10 minutes.

Reply STOP to opt out.`;
}

/**
 * Welcome SMS after phone verification
 */
export function welcomeSMS(firstName?: string): string {
  return `🎉 Welcome to Novara${firstName ? `, ${firstName}` : ''}!

Your phone is verified. You'll receive job offers via SMS.

Reply HELP for commands or STOP to opt out.`;
}

/**
 * Job reminder (sent day before)
 */
export function jobReminderSMS(job: JobDetails): string {
  return `📢 REMINDER: Job tomorrow!

📅 ${job.date} at ${job.time}
📍 ${job.address || job.city}, ${job.zip}

Check app for customer notes. Be on time!`;
}

/**
 * Job starting soon (sent 1 hour before)
 */
export function jobStartingSoonSMS(job: JobDetails): string {
  return `⏰ Job starts in 1 hour!

📍 ${job.address || job.city}, ${job.zip}
⏱️ ${job.time}

Open app for directions. Drive safe!`;
}

/**
 * Job check-in reminder
 */
export function checkInReminderSMS(job: JobDetails): string {
  return `📍 Don't forget to CHECK IN when you arrive!

${job.address || job.city}, ${job.zip}

Open the app and tap "I'm Here" to start the timer.`;
}

/**
 * Job completed confirmation
 */
export function jobCompletedSMS(earnings: string): string {
  return `✅ Great job! Cleaning completed.

💰 Earned: $${earnings}

Your payout will be processed soon. Thanks for your hard work!`;
}

/**
 * Payout sent notification
 */
export function payoutSentSMS(amount: string, method: string): string {
  return `💰 PAYOUT SENT!

$${amount} sent via ${method}

Check your ${method} account. Usually arrives within 1-3 business days.`;
}

/**
 * Rating received
 */
export function ratingReceivedSMS(rating: number, tip?: string): string {
  const stars = '⭐'.repeat(Math.min(rating, 5));
  const tipMsg = tip ? `\n💵 Tip: $${tip}` : '';
  return `${stars} You got a ${rating}-star rating!${tipMsg}

Great work! Keep it up to earn more jobs.`;
}

/**
 * Account status update
 */
export function accountStatusSMS(status: string, reason?: string): string {
  if (status === 'approved') {
    return `🎉 Congrats! Your Novara account is APPROVED!

You can now receive job offers. Make sure your availability is set in the app.

Let's get cleaning! 🧹`;
  } else if (status === 'suspended') {
    return `⚠️ Your Novara account has been suspended.
${reason ? `\nReason: ${reason}` : ''}

Contact support@novaracleaning.com for assistance.`;
  } else if (status === 'pending') {
    return `📋 Your application is under review.

We'll notify you once approved. This usually takes 1-2 business days.`;
  }
  return `Account status updated to: ${status}`;
}

/**
 * Help response
 */
export function helpSMS(): string {
  return `Novara SMS Commands:
ACCEPT - Accept pending job
DECLINE - Decline pending job
STATUS - Check your stats
STOP - Unsubscribe from SMS
START - Resubscribe

Need help? Call (202) 555-0123`;
}

/**
 * Status response
 */
export function statusSMS(firstName: string, pendingOffers: number, confirmedJobs: number): string {
  return `Hi ${firstName}!

📋 Pending offers: ${pendingOffers}
✅ Confirmed jobs: ${confirmedJobs}

Reply HELP for more commands.`;
}

/**
 * Opt-out confirmation
 */
export function optOutSMS(): string {
  return `You've been unsubscribed from Novara SMS.

Reply START to re-subscribe.

You can still use the app for notifications.`;
}

/**
 * Opt-in confirmation
 */
export function optInSMS(): string {
  return `You're now subscribed to Novara SMS notifications.

Reply STOP to unsubscribe or HELP for commands.`;
}

/**
 * Job cancelled notification
 */
export function jobCancelledSMS(job: JobDetails, reason?: string): string {
  return `⚠️ JOB CANCELLED

The job on ${job.date} at ${job.city} has been cancelled.
${reason ? `\nReason: ${reason}` : ''}

We'll send you new offers soon!`;
}

/**
 * Job rescheduled notification
 */
export function jobRescheduledSMS(oldDate: string, newJob: JobDetails): string {
  return `📅 JOB RESCHEDULED

Your job has been moved:
From: ${oldDate}
To: ${newJob.date} at ${newJob.time}

Location: ${newJob.city}, ${newJob.zip}

Open app to confirm.`;
}
