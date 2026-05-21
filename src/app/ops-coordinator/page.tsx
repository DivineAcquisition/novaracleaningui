"use client";

import {
  RiComputerLine,
  RiTimeLine,
  RiLineChartLine,
  RiHeart3Line,
  RiCalendarLine,
  RiSettings3Line,
} from "@remixicon/react";
import RoleDetailLayout from "@/components/hiring/RoleDetailLayout";

const jobData = {
  title: "Operations Coordinator",
  subtitle: "Operations",
  department: "Operations",
  location: "Remote",
  type: "Full-time",
  compensation: "Based on Experience",
  mission:
    "Operations is the backbone of everything we do. As Operations Coordinator, you'll be the central hub that connects our cleaners with our customers, ensuring every job runs smoothly and every customer has an exceptional experience.",
  description:
    "Coordinate daily operations, manage cleaner schedules, and ensure smooth service delivery across our growing operation.",
  techStack: ["Supabase", "GoHighLevel", "Slack", "Google Workspace", "Zapier"],
  sections: [
    {
      title: "Responsibilities",
      items: [
        "Manage daily scheduling and dispatch for cleaning teams",
        "Coordinate with cleaners to optimize routes and maximize efficiency",
        "Handle customer inquiries, rescheduling requests, and feedback",
        "Monitor job completion and quality through our app systems",
        "Track key operational metrics and prepare weekly reports",
        "Troubleshoot scheduling conflicts and last-minute changes",
        "Support onboarding of new team members",
      ],
    },
    {
      title: "Requirements",
      items: [
        "2+ years in operations, scheduling, or coordination role",
        "Experience with scheduling software and CRM tools",
        "Excellent communication skills (written and verbal)",
        "Strong organizational skills and attention to detail",
        "Ability to multitask and prioritize in fast-paced environment",
        "Problem-solving mindset and proactive approach",
        "Reliable internet connection for remote work",
      ],
    },
    {
      title: "Who This Is For",
      items: [
        "Detail-oriented individuals who love bringing order to chaos",
        "People who thrive in dynamic, fast-paced environments",
        "Strong communicators who can work with diverse teams",
        "Self-starters who take ownership of their responsibilities",
        "Those who genuinely care about customer satisfaction",
      ],
    },
    {
      title: "Who This Is NOT For",
      items: [
        "Those who struggle with multiple priorities simultaneously",
        "People who avoid difficult conversations",
        "Anyone who needs constant supervision to stay productive",
        "Those who panic under pressure instead of problem-solving",
      ],
    },
    {
      title: "What Success Looks Like",
      items: [
        "95%+ on-time job completion rate",
        "Same-day response to all customer inquiries",
        "Zero missed appointments due to scheduling errors",
        "Positive feedback from cleaners about support received",
        "Weekly reports delivered on time with actionable insights",
      ],
    },
    {
      title: "Compensation",
      items: [
        "Competitive salary based on experience",
        "Performance bonuses tied to operational metrics",
        "Health insurance stipend",
        "Paid time off and holidays",
        "Home office equipment allowance",
      ],
    },
  ],
  benefits: [
    { icon: RiComputerLine, title: "Remote Work", desc: "Work from anywhere" },
    { icon: RiTimeLine, title: "Flexible Hours", desc: "Core hours with flexibility" },
    { icon: RiLineChartLine, title: "Growth Path", desc: "Advance as we scale" },
    { icon: RiHeart3Line, title: "Health Stipend", desc: "Insurance contribution" },
    { icon: RiCalendarLine, title: "PTO", desc: "Paid time off + holidays" },
    { icon: RiSettings3Line, title: "Equipment", desc: "Home office allowance" },
  ],
};

export default function OpsCoordinatorPage() {
  return <RoleDetailLayout jobData={jobData} filloutId="p9FCwh89JPus" />;
}

export const dynamic = "force-dynamic";
