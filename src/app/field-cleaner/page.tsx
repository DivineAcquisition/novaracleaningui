"use client";

import {
  RiTimeLine,
  RiMoneyDollarCircleLine,
  RiSparklingLine,
  RiCarLine,
  RiSmartphoneLine,
  RiHeart3Line,
} from "@remixicon/react";
import RoleDetailLayout from "@/components/hiring/RoleDetailLayout";
import AscensionProgram from "@/components/hiring/AscensionProgram";

const jobData = {
  title: "Field Cleaner",
  subtitle: "Operations",
  department: "Operations",
  location: "Washington DC Metro Area",
  type: "Part-time / Full-time",
  compensation: "$18 - $25/hour",
  mission:
    "We believe every home deserves exceptional care. Our Field Cleaners are the heart of Novara, transforming spaces and creating joy for our customers through meticulous attention to detail and genuine care.",
  description:
    "Join our team of professional cleaners delivering exceptional cleaning services to homes across the DMV area. Flexible hours and competitive pay.",
  sections: [
    {
      title: "Responsibilities",
      items: [
        "Perform residential deep cleaning and maintenance cleaning services",
        "Follow our comprehensive 40-point cleaning checklist",
        "Communicate professionally with clients about their needs",
        "Maintain and care for cleaning supplies and equipment",
        "Complete jobs within estimated timeframes",
        "Report any issues or special requests to management",
        "Maintain a positive, professional attitude at all times",
      ],
    },
    {
      title: "Requirements",
      items: [
        "Reliable personal transportation to travel between job sites",
        "Smartphone capable of running our job management app",
        "Ability to lift up to 25 lbs and stand for extended periods",
        "Strong attention to detail and pride in your work",
        "Positive attitude and professional demeanor",
        "Ability to pass a background check",
        "Legal authorization to work in the United States",
      ],
    },
    {
      title: "Who This Is For",
      items: [
        "People who take pride in creating clean, organized spaces",
        "Self-motivated individuals who work well independently",
        "Those seeking flexible hours to fit their lifestyle",
        "Anyone looking to join a growing, supportive team",
      ],
    },
    {
      title: "Who This Is NOT For",
      items: [
        "Those who cut corners or rush through tasks",
        "People who struggle with physical activity",
        "Anyone unreliable with scheduling or punctuality",
        "Those who can't maintain a professional attitude",
      ],
    },
    {
      title: "Compensation",
      items: [
        "Starting pay: $18-$25/hour based on experience",
        "Performance bonuses for 5-star reviews",
        "Mileage reimbursement for travel between jobs",
        "Weekly direct deposit payments",
        "Opportunity for raises as you grow",
      ],
    },
  ],
  benefits: [
    { icon: RiTimeLine, title: "Flexible Scheduling", desc: "You choose your hours" },
    { icon: RiMoneyDollarCircleLine, title: "Weekly Pay", desc: "Direct deposit every week" },
    { icon: RiSparklingLine, title: "Performance Bonuses", desc: "Earn more with great reviews" },
    { icon: RiCarLine, title: "Mileage Reimbursement", desc: "Gas compensation provided" },
    { icon: RiSmartphoneLine, title: "Equipment Provided", desc: "All supplies included" },
    { icon: RiHeart3Line, title: "Supportive Team", desc: "Training and ongoing support" },
  ],
};

export default function FieldCleanerPage() {
  return (
    <RoleDetailLayout
      jobData={jobData}
      filloutId="p9FCwh89JPus"
      extraSection={<AscensionProgram />}
    />
  );
}

export const dynamic = "force-dynamic";
