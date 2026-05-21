"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RiMapPinLine,
  RiTimeLine,
  RiMoneyDollarCircleLine,
  RiArrowRightLine,
  RiSparklingLine,
  RiSendPlaneLine,
  RiLoader4Line,
  RiBuilding2Line,
  RiBriefcaseLine,
  RiGroupLine,
  RiHomeLine,
} from "@remixicon/react";
import { toast } from "sonner";

// Cross-subdomain absolute URL for the application/role detail pages —
// strict architecture: hiring.* is marketing only, contractor.* hosts
// the role detail + application form pages at root-level slugs.
const CONTRACTOR_HOST = "https://contractor.novaracleaning.com";

interface Job {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  department: string;
  location: string;
  region: string;
  type: string;
  salary: string;
  level: number;
}

const jobs: Job[] = [
  {
    id: "field-cleaner",
    slug: "field-cleaner",
    title: "Field Cleaner",
    subtitle: "Operations",
    description:
      "Join our team of professional cleaners delivering exceptional cleaning services to homes across the DMV area. Flexible hours and competitive pay.",
    department: "operations",
    location: "on-site",
    region: "Washington DC Metro",
    type: "Part-time / Full-time",
    salary: "$18 - $25/hour",
    level: 1,
  },
  {
    id: "ops-coordinator",
    slug: "ops-coordinator",
    title: "Operations Coordinator",
    subtitle: "Operations",
    description:
      "Coordinate daily operations, manage cleaner schedules, and ensure smooth service delivery across our growing operation.",
    department: "operations",
    location: "remote",
    region: "Remote",
    type: "Full-time",
    salary: "Based on Experience",
    level: 2,
  },
  {
    id: "executive-assistant",
    slug: "executive-assistant",
    title: "Executive Assistant",
    subtitle: "Executive",
    description:
      "Support the executive team with administrative tasks, project management, and strategic initiatives as we scale.",
    department: "executive",
    location: "remote",
    region: "Remote",
    type: "Full-time",
    salary: "Based on Experience",
    level: 3,
  },
];

const departments = [
  { id: "all", name: "View All", icon: RiGroupLine },
  { id: "operations", name: "Operations", icon: RiBuilding2Line },
  { id: "executive", name: "Executive", icon: RiBriefcaseLine },
];

const locations = [
  { id: "remote", name: "Remote", icon: RiHomeLine },
  { id: "on-site", name: "On-Site", icon: RiMapPinLine },
];

const levelLabels: Record<number, string> = {
  1: "Entry",
  2: "Mid",
  3: "Senior",
  4: "Lead",
};

function LevelIndicator({ level }: { level: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex gap-0.5">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`level-dot ${i <= level ? "active" : "inactive"}`} />
        ))}
      </span>
      <span className="text-slate-500 text-xs">{levelLabels[level]}</span>
    </span>
  );
}

export default function Hiring() {
  const [selectedDept, setSelectedDept] = useState("all");
  const [selectedLocations, setSelectedLocations] = useState<string[]>(["remote", "on-site"]);
  const [sortBy, setSortBy] = useState("level-high");
  const [mounted, setMounted] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    linkedin: "",
    message: "",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleLocation = (locationId: string) => {
    setSelectedLocations((prev) =>
      prev.includes(locationId) ? prev.filter((l) => l !== locationId) : [...prev, locationId],
    );
  };

  const filteredJobs = jobs
    .filter((job) => {
      if (selectedDept !== "all" && job.department !== selectedDept) return false;
      if (!selectedLocations.includes(job.location)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "level-high") return b.level - a.level;
      if (sortBy === "level-low") return a.level - b.level;
      return 0;
    });

  const deptCounts = jobs.reduce((acc, job) => {
    acc[job.department] = (acc[job.department] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    toast.success("Application submitted! We'll be in touch within 48 hours.");
    setIsApplying(false);
    setFormData({ name: "", email: "", phone: "", linkedin: "", message: "" });
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased selection:bg-primary/20 selection:text-primary overflow-x-hidden">
      {/* Grid Background */}
      <div className="fixed inset-0 pointer-events-none grid-pattern" />

      {/* Background Glow Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-full md:w-[1200px] h-[800px]"
          style={{
            background:
              "radial-gradient(ellipse at center, hsl(260 100% 50% / 0.08) 0%, hsl(260 100% 50% / 0.03) 40%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full opacity-60"
          style={{
            background: "radial-gradient(circle, hsl(260 100% 70% / 0.1) 0%, transparent 60%)",
            filter: "blur(80px)",
          }}
        />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-20 border-b border-slate-200/50 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto h-full px-6 flex items-center justify-between">
          <Link href="/hiring" className="flex items-center gap-3 group">
            <Image
              src="/novara-logo.png"
              alt="Novara"
              width={40}
              height={40}
              className="h-10 w-10 rounded-xl group-hover:opacity-80 transition-opacity"
            />
            <span className="font-bold text-xl text-slate-900">Novara</span>
          </Link>

          <a
            href="#positions"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping-dot absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            {jobs.length} Open Roles
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 px-6 pt-36 pb-16 md:pt-44 md:pb-20">
        <div className="max-w-3xl mx-auto text-center">
          <div className={`glow-badge mb-8 ${mounted ? "animate-fade-in" : "opacity-0"}`}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping-dot absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            We&apos;re Hiring
          </div>

          <h1
            className={`text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.1]
              ${mounted ? "animate-fade-in animation-delay-100" : "opacity-0"}`}
          >
            <span className="text-slate-900">Build Your Career</span>
            <br />
            <span className="text-primary">With Novara</span>
          </h1>

          <p
            className={`text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto mb-10
              ${mounted ? "animate-fade-in animation-delay-200" : "opacity-0"}`}
          >
            Join a fast-growing team transforming the home cleaning industry. We&apos;re looking for
            ambitious people ready to deliver exceptional experiences.
          </p>

          <div
            className={`flex flex-wrap justify-center gap-3
              ${mounted ? "animate-fade-in animation-delay-300" : "opacity-0"}`}
          >
            {["Excellence", "Growth", "Flexibility"].map((value) => (
              <span
                key={value}
                className="px-4 py-2 rounded-full text-sm font-medium bg-slate-100 border border-slate-200 text-slate-700 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-default"
              >
                {value}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Positions Section */}
      <main className="relative z-10 px-6 pb-20" id="positions">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Sidebar Filter */}
            <aside
              className={`lg:w-72 flex-shrink-0 ${mounted ? "animate-fade-in animation-delay-300" : "opacity-0"}`}
            >
              <div className="lg:sticky lg:top-28 filter-sidebar space-y-8">
                <div>
                  <h3 className="section-label mb-4">Department</h3>
                  <div className="space-y-1">
                    {departments.map((dept) => {
                      const count = dept.id === "all" ? jobs.length : deptCounts[dept.id] || 0;
                      const isSelected = selectedDept === dept.id;
                      const Icon = dept.icon;
                      return (
                        <button
                          key={dept.id}
                          onClick={() => setSelectedDept(dept.id)}
                          className={`filter-button ${isSelected ? "active" : ""}`}
                        >
                          <span className="flex items-center gap-2">
                            <Icon className="w-4 h-4" />
                            {dept.name}
                          </span>
                          <span className={`text-xs ${isSelected ? "text-slate-900" : "text-slate-400"}`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="section-label mb-4">Location</h3>
                  <div className="space-y-2">
                    {locations.map((location) => {
                      const Icon = location.icon;
                      return (
                        <label key={location.id} className="flex items-center gap-3 cursor-pointer group">
                          <div
                            className={`w-5 h-5 rounded flex items-center justify-center transition-all ${
                              selectedLocations.includes(location.id)
                                ? "bg-primary border-primary"
                                : "bg-white border-2 border-slate-200 group-hover:border-slate-300"
                            }`}
                            onClick={() => toggleLocation(location.id)}
                          >
                            {selectedLocations.includes(location.id) && (
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={3}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            )}
                          </div>
                          <span className="flex items-center gap-2 text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                            <Icon className="w-4 h-4" />
                            {location.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="section-label mb-4">Sort By</h3>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-full bg-white border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="level-high">Level: High to Low</SelectItem>
                      <SelectItem value="level-low">Level: Low to High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </aside>

            {/* Job Listings */}
            <div className="flex-1">
              <div
                className={`flex items-center justify-between mb-6 ${mounted ? "animate-fade-in animation-delay-300" : "opacity-0"}`}
              >
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Open Positions</h2>
                  <p className="text-slate-500 text-sm mt-1">{filteredJobs.length} roles available</p>
                </div>
              </div>

              <div className={`space-y-4 ${mounted ? "animate-fade-in animation-delay-400" : "opacity-0"}`}>
                {filteredJobs.map((job) => (
                  <a
                    key={job.id}
                    href={`${CONTRACTOR_HOST}/${job.slug}`}
                    className="block group"
                  >
                    <div className="job-card relative p-6 rounded-2xl bg-white border border-slate-200 overflow-hidden">
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[150px] bg-primary/5 blur-[50px]" />
                      </div>

                      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-semibold text-slate-900 group-hover:text-primary transition-colors">
                              {job.title}
                            </h3>
                            <Badge
                              variant="secondary"
                              className="bg-primary/10 text-primary border-0 text-xs font-semibold"
                            >
                              {job.subtitle}
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-500 leading-relaxed mb-3 line-clamp-2">
                            {job.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span className="flex items-center gap-1.5">
                              <RiMapPinLine className="w-3.5 h-3.5" />
                              {job.region}
                            </span>
                            <span className="w-1 h-1 rounded-full bg-slate-300" />
                            <span className="flex items-center gap-1.5">
                              <RiTimeLine className="w-3.5 h-3.5" />
                              {job.type}
                            </span>
                            <span className="w-1 h-1 rounded-full bg-slate-300" />
                            <span className="flex items-center gap-1.5">
                              <RiMoneyDollarCircleLine className="w-3.5 h-3.5" />
                              {job.salary}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <LevelIndicator level={job.level} />
                          <RiArrowRightLine className="job-arrow w-5 h-5 text-slate-400 transition-all" />
                        </div>
                      </div>
                    </div>
                  </a>
                ))}

                {filteredJobs.length === 0 && (
                  <div className="text-center py-16 rounded-2xl bg-slate-50 border border-slate-200">
                    <p className="text-slate-500">No positions found matching your filters.</p>
                    <button
                      onClick={() => {
                        setSelectedDept("all");
                        setSelectedLocations(["remote", "on-site"]);
                      }}
                      className="mt-3 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                    >
                      Reset filters
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* CTA Section */}
      <section className="relative z-10 py-20 bg-slate-50 border-t border-slate-200">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <Badge className="mb-6 bg-primary/10 text-primary border-0">
            <RiSparklingLine className="w-4 h-4 mr-2" />
            General Applications
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
            Don&apos;t See the Perfect Role?
          </h2>
          <p className="text-lg text-slate-600 mb-8 max-w-2xl mx-auto">
            We&apos;re always looking for exceptional talent. Send us your information and we&apos;ll
            reach out when something opens up that matches your skills.
          </p>
          <Button
            size="lg"
            className="h-14 px-10 text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
            onClick={() => setIsApplying(true)}
          >
            <RiSendPlaneLine className="w-5 h-5 mr-2" />
            Submit General Application
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <Image
                src="/novara-logo.png"
                alt="Novara"
                width={32}
                height={32}
                className="h-8 w-8 rounded-lg opacity-80 hover:opacity-100 transition-opacity"
              />
              <span className="text-slate-500 text-sm font-medium">
                {new Date().getFullYear()} © Novara Cleaning. All rights reserved.
              </span>
            </div>
            <div className="flex items-center gap-6">
              <a
                href="https://novaracleaning.com"
                className="text-xs text-slate-400 font-medium hover:text-primary transition-colors"
              >
                Website
              </a>
              <a
                href="mailto:careers@novaracleaning.com"
                className="text-xs text-slate-400 font-medium hover:text-primary transition-colors"
              >
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Application Modal */}
      <Dialog open={isApplying} onOpenChange={setIsApplying}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">General Application</DialogTitle>
            <DialogDescription>
              Submit your information and we&apos;ll contact you when a matching role opens up.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 pt-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                  required
                  className="h-11"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={formData.phone}
                  onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="linkedin">LinkedIn URL</Label>
                <Input
                  id="linkedin"
                  type="url"
                  placeholder="linkedin.com/in/..."
                  value={formData.linkedin}
                  onChange={(e) => setFormData((p) => ({ ...p, linkedin: e.target.value }))}
                  className="h-11"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">Tell us about yourself *</Label>
              <Textarea
                id="message"
                placeholder="What roles interest you? What experience do you bring?"
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData((p) => ({ ...p, message: e.target.value }))}
                required
              />
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <RiLoader4Line className="w-5 h-5 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  Submit Application
                  <RiArrowRightLine className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>

            <p className="text-xs text-center text-slate-500">
              By submitting, you agree to our privacy policy and consent to being contacted.
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const dynamic = "force-dynamic";
