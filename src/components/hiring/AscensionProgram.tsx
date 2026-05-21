"use client";

import { RiCheckboxCircleLine, RiRefreshLine, RiTrophyLine } from "@remixicon/react";

export default function AscensionProgram() {
  return (
    <section className="mb-16 animate-fade-in animation-delay-400">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-white shadow-lg shadow-primary/30">
          <RiTrophyLine className="w-4 h-4" />
        </div>
        <div>
          <h2 className="section-label">Novara Ascension Program</h2>
          <p className="text-xs text-slate-500 mt-0.5">"Grow With Us"</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-8">
        {/* Foundation */}
        <div className="relative p-6 rounded-2xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-all">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm">1</span>
            <div>
              <h3 className="font-semibold text-slate-900">Foundation</h3>
              <p className="text-xs text-slate-500">Entry Level</p>
            </div>
          </div>
          <div className="mb-4">
            <p className="text-2xl font-bold text-slate-900">$18<span className="text-sm font-normal text-slate-500">/hr</span></p>
          </div>
          <div className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Requirements</p>
            <ul className="text-sm text-slate-600 space-y-1">
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-slate-400 mt-2 shrink-0" />New contractor (0–6 months)</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-slate-400 mt-2 shrink-0" />Completed onboarding + training</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-slate-400 mt-2 shrink-0" />Maintain 4.8+ star rating</li>
            </ul>
          </div>
          <div className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Job Access</p>
            <p className="text-sm text-slate-600">Standard cleans only</p>
          </div>
          <div className="pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-500">Platform Fee: <span className="font-semibold text-slate-700">10%</span></p>
          </div>
        </div>

        {/* Proven */}
        <div className="relative p-6 rounded-2xl bg-gradient-to-br from-primary/5 to-white border-2 border-primary/20 hover:border-primary/40 transition-all">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="px-3 py-1 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">POPULAR</span>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">2</span>
            <div>
              <h3 className="font-semibold text-slate-900">Proven</h3>
              <p className="text-xs text-slate-500">Mid Level</p>
            </div>
          </div>
          <div className="mb-4">
            <p className="text-2xl font-bold text-primary">$20<span className="text-sm font-normal text-slate-500">/hr</span></p>
          </div>
          <div className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Requirements</p>
            <ul className="text-sm text-slate-600 space-y-1">
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />6+ months tenure</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />25+ jobs completed</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />4.8+ star rating average</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" />90%+ on-time rate</li>
            </ul>
          </div>
          <div className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Job Access</p>
            <p className="text-sm text-slate-600">Standard cleans + Deep cleans (higher pay)</p>
          </div>
          <div className="pt-4 border-t border-primary/10">
            <p className="text-xs text-slate-500">Platform Fee: <span className="font-semibold text-primary">7%</span></p>
          </div>
        </div>

        {/* Elite */}
        <div className="relative p-6 rounded-2xl bg-gradient-to-br from-amber-50 to-white border-2 border-amber-200 hover:border-amber-300 transition-all">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="px-3 py-1 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">TOP TIER</span>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center text-amber-700 font-bold text-sm">3</span>
            <div>
              <h3 className="font-semibold text-slate-900">Elite</h3>
              <p className="text-xs text-slate-500">Top Performer</p>
            </div>
          </div>
          <div className="mb-4">
            <p className="text-2xl font-bold text-amber-600">$22<span className="text-sm font-normal text-slate-500">/hr</span></p>
          </div>
          <div className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Requirements</p>
            <ul className="text-sm text-slate-600 space-y-1">
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-amber-500 mt-2 shrink-0" />12+ months tenure</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-amber-500 mt-2 shrink-0" />50+ jobs completed</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-amber-500 mt-2 shrink-0" />4.8+ star rating average</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-amber-500 mt-2 shrink-0" />95%+ on-time rate</li>
            </ul>
          </div>
          <div className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Job Access</p>
            <p className="text-sm text-slate-600">All job types + Priority booking (first access)</p>
          </div>
          <div className="pt-4 border-t border-amber-200">
            <p className="text-xs text-slate-500">Platform Fee: <span className="font-semibold text-amber-600">5%</span></p>
          </div>
        </div>
      </div>

      <div className="p-6 rounded-xl bg-slate-50 border border-slate-200">
        <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <RiRefreshLine className="w-4 h-4 text-primary" />
          Tier Review Process
        </h4>
        <ul className="space-y-2 text-sm text-slate-600">
          <li className="flex items-start gap-2"><RiCheckboxCircleLine className="w-4 h-4 text-primary mt-0.5 shrink-0" />Automatic review at 6 months and 12 months</li>
          <li className="flex items-start gap-2"><RiCheckboxCircleLine className="w-4 h-4 text-primary mt-0.5 shrink-0" />Contractors can request early review if metrics are met</li>
          <li className="flex items-start gap-2"><RiCheckboxCircleLine className="w-4 h-4 text-primary mt-0.5 shrink-0" />Tier status can be downgraded if rating drops below 4.8 for 60+ days</li>
        </ul>
      </div>
    </section>
  );
}
