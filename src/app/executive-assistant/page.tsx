"use client";

import {
  RiComputerLine,
  RiHeart3Line,
  RiLineChartLine,
  RiCalendarLine,
  RiFlashlightLine,
  RiShieldLine,
} from "@remixicon/react";
import RoleDetailLayout from "@/components/hiring/RoleDetailLayout";

const jobData = {
  title: "Executive Assistant",
  subtitle: "Executive",
  department: "Executive",
  location: "Remote",
  type: "Full-time",
  compensation: "Based on Experience",
  mission:
    "Behind every successful executive is an exceptional assistant. As our Executive Assistant, you'll be the force multiplier that enables our leadership team to focus on what matters most — scaling the company and serving our customers.",
  description:
    "Support the executive team with administrative tasks, project management, and strategic initiatives as we scale.",
  techStack: ["Notion", "Google Workspace", "Slack", "Calendly", "Asana", "Loom"],
  sections: [
    {
      title: "Responsibilities",
      items: [
        "Manage complex calendars and coordinate meetings across time zones",
        "Prepare briefing documents, presentations, and reports",
        "Handle email correspondence and prioritize communications",
        "Coordinate travel arrangements and logistics",
        "Track and follow up on action items from meetings",
        "Manage special projects and strategic initiatives",
        "Maintain confidential information with discretion",
      ],
    },
    {
      title: "Requirements",
      items: [
        "3+ years as an executive assistant or similar role",
        "Exceptional written and verbal communication skills",
        "Expert proficiency with productivity tools (Google Workspace, Notion, etc.)",
        "Strong project management and organizational abilities",
        "Ability to anticipate needs and act proactively",
        "High emotional intelligence and discretion",
        "Experience supporting C-level executives preferred",
      ],
    },
    {
      title: "Who This Is For",
      items: [
        "Highly organized individuals who love bringing structure to chaos",
        "Proactive thinkers who anticipate needs before they arise",
        "Strong communicators who can represent executives professionally",
        "Detail-oriented professionals who never let things slip through the cracks",
        "Those who thrive in fast-paced, high-stakes environments",
      ],
    },
    {
      title: "Who This Is NOT For",
      items: [
        "Those who wait to be told what to do",
        "People who struggle with confidentiality",
        "Anyone uncomfortable making decisions independently",
        "Those who can't handle rapid priority changes",
      ],
    },
    {
      title: "What Success Looks Like",
      items: [
        "Executives feel confident delegating — nothing falls through the cracks",
        "Meetings are always prepared and follow-ups tracked",
        "Proactive problem-solving prevents issues before they arise",
        "Executives gain 10+ hours per week through effective support",
        "Trusted as a strategic partner, not just administrative support",
      ],
    },
    {
      title: "Compensation",
      items: [
        "Competitive salary based on experience",
        "Performance bonuses tied to executive team productivity",
        "Comprehensive health insurance",
        "Paid time off and flexible scheduling",
        "Professional development budget",
        "Home office setup allowance",
      ],
    },
  ],
  benefits: [
    { icon: RiComputerLine, title: "Remote Work", desc: "Work from anywhere" },
    { icon: RiHeart3Line, title: "Health Insurance", desc: "Full coverage provided" },
    { icon: RiLineChartLine, title: "Growth Path", desc: "Chief of Staff potential" },
    { icon: RiCalendarLine, title: "Flexible PTO", desc: "Generous time off policy" },
    { icon: RiFlashlightLine, title: "Learning Budget", desc: "Professional development" },
    { icon: RiShieldLine, title: "Equipment", desc: "Premium home office setup" },
  ],
};

export default function ExecutiveAssistantPage() {
  return <RoleDetailLayout jobData={jobData} filloutId="p9FCwh89JPus" />;
}

export const dynamic = "force-dynamic";
