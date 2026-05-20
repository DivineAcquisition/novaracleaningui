// report-export
//
// Single-endpoint CSV (or JSON) export for every Phase-5 report:
//
//   POST { report: 'daily' | 'weekly' | 'monthly' | 'funnel' | 'recurring'
//        | 'payroll' | 'heatmap_leads' | 'heatmap_bookings' | 'heatmap_cleaners'
//        | 'cleaner_scorecard' | 'cleaner_calendar' | 'cleaner_earnings'
//        | 'compliance' | 'zone_capacity',
//          params?: any, format?: 'csv' | 'json' }
//
// Returns either:
//   { format: 'json', rows: [...] }       // when format='json'
//   { format: 'csv',  csv: '...' }        // when format='csv' (default)
//
// 100% read-only. Calls existing RPCs / views — never mutates.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows || rows.length === 0) return "";
  const headers = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") v = JSON.stringify(v);
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

function parseDateRange(p: any): { start: string; end: string } {
  const end = (p?.end || new Date().toISOString().slice(0, 10)) as string;
  const start = (p?.start || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)) as string;
  return { start, end };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const report: string = body.report;
    const params = body.params || {};
    const format: string = body.format || "csv";

    if (!report) {
      return new Response(JSON.stringify({ error: "report required" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    let rows: Array<Record<string, unknown>> = [];
    let single: Record<string, unknown> | null = null;

    switch (report) {
      case "daily": {
        const { start, end } = parseDateRange(params);
        const { data, error } = await supabase.from("daily_metrics_v1").select("*").gte("day", start).lte("day", end).order("day", { ascending: false });
        if (error) throw error;
        rows = data || [];
        break;
      }
      case "weekly": {
        const { data, error } = await supabase.from("weekly_metrics_v1").select("*").limit(52);
        if (error) throw error;
        rows = data || [];
        break;
      }
      case "monthly": {
        const { data, error } = await supabase.from("monthly_metrics_v1").select("*").limit(24);
        if (error) throw error;
        rows = data || [];
        break;
      }
      case "funnel": {
        const { data, error } = await supabase.from("lead_funnel_v1").select("*");
        if (error) throw error;
        rows = data || [];
        break;
      }
      case "recurring": {
        const { data, error } = await supabase.from("recurring_customers_v1").select("*").limit(500);
        if (error) throw error;
        rows = data || [];
        break;
      }
      case "payroll": {
        const { start, end } = parseDateRange(params);
        const { data, error } = await supabase.rpc("cleaner_payroll_report", { _period_start: start, _period_end: end });
        if (error) throw error;
        rows = data || [];
        break;
      }
      case "heatmap_leads": {
        const { start, end } = parseDateRange(params);
        const { data, error } = await supabase.rpc("heatmap_leads_by_zip", { _start: start, _end: end });
        if (error) throw error;
        rows = data || [];
        break;
      }
      case "heatmap_bookings": {
        const { start, end } = parseDateRange(params);
        const { data, error } = await supabase.rpc("heatmap_bookings_by_zip", { _start: start, _end: end });
        if (error) throw error;
        rows = data || [];
        break;
      }
      case "heatmap_cleaners": {
        const { data, error } = await supabase.rpc("heatmap_cleaner_density");
        if (error) throw error;
        rows = data || [];
        break;
      }
      case "cleaner_scorecard": {
        if (!params.cleanerId) throw new Error("params.cleanerId required");
        const { data, error } = await supabase.rpc("get_cleaner_scorecard", { _cleaner_id: params.cleanerId });
        if (error) throw error;
        single = data as Record<string, unknown>;
        break;
      }
      case "cleaner_calendar": {
        if (!params.cleanerId) throw new Error("params.cleanerId required");
        const { start, end } = parseDateRange(params);
        const { data, error } = await supabase.rpc("get_cleaner_calendar", { _cleaner_id: params.cleanerId, _start: start, _end: end });
        if (error) throw error;
        single = data as Record<string, unknown>;
        break;
      }
      case "cleaner_earnings": {
        if (!params.cleanerId) throw new Error("params.cleanerId required");
        const { start, end } = parseDateRange(params);
        const { data, error } = await supabase.rpc("get_cleaner_earnings", { _cleaner_id: params.cleanerId, _start: start, _end: end });
        if (error) throw error;
        single = data as Record<string, unknown>;
        break;
      }
      case "compliance": {
        const flag = params.flag || "expiring_soon"; // expiring_soon | expired | unverified
        const { data, error } = await supabase
          .from("cleaners")
          .select("id, first_name, last_name, status, background_check_status, background_check_expires_at, insurance_verified, insurance_expires_at")
          .eq("status", "active");
        if (error) throw error;
        const today = new Date().toISOString().slice(0, 10);
        const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
        rows = (data || []).filter((c: any) => {
          const bgExp = c.background_check_expires_at;
          const insExp = c.insurance_expires_at;
          if (flag === "expired") return (bgExp && bgExp < today) || (insExp && insExp < today);
          if (flag === "unverified") return !c.insurance_verified || !c.background_check_expires_at;
          return (bgExp && bgExp <= horizon) || (insExp && insExp <= horizon);
        });
        break;
      }
      case "zone_capacity": {
        const date = params.date || new Date().toISOString().slice(0, 10);
        const zips = (params.zips as string[]) || [];
        if (zips.length === 0) throw new Error("params.zips required");
        for (const z of zips) {
          const { data, error } = await supabase.rpc("get_zone_capacity", { _zip: z, _date: date });
          if (error) throw error;
          rows.push(data as Record<string, unknown>);
        }
        break;
      }
      default:
        return new Response(JSON.stringify({ error: `unknown report: ${report}` }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    if (single) {
      if (format === "json") {
        return new Response(JSON.stringify({ format: "json", data: single }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      const flat: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(single)) flat[k] = typeof v === "object" ? JSON.stringify(v) : v;
      return new Response(JSON.stringify({ format: "csv", csv: toCsv([flat]) }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    if (format === "json") {
      return new Response(JSON.stringify({ format: "json", rows, count: rows.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }
    return new Response(JSON.stringify({ format: "csv", count: rows.length, csv: toCsv(rows) }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[report-export] error", message);
    return new Response(JSON.stringify({ error: message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});
