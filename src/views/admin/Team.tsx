"use client";

// ─── Admin Team (portal users) ──────────────────────────────────────────
//
// Manage who can log into the admin console: admins + VAs (virtual
// assistants). VAs get the same console access as admins (RLS parity via
// the va_admin_portal_access migration). Only admins can manage the team
// — the admin-create-team-user edge function enforces this server-side.

import { useEffect, useState } from "react";
import {
  RiUserAddLine,
  RiLoader4Line,
  RiShieldStarLine,
  RiUserStarLine,
  RiDeleteBinLine,
  RiRefreshLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TeamUser {
  userId: string;
  email: string | null;
  roles: string[];
  created_at: string;
}

export default function AdminTeam() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState<TeamUser[]>([]);

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<"va" | "admin">("va");
  const [busy, setBusy] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-team-user", {
        body: { action: "list" },
      });
      if (error) throw error;
      if ((data as any)?.error) {
        if (String((data as any).error).toLowerCase().includes("admins only")) {
          setForbidden(true);
          return;
        }
        throw new Error((data as any).error);
      }
      setUsers(((data as any)?.users || []) as TeamUser[]);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't load team");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createUser = async () => {
    if (!email.trim()) {
      toast.error("Email is required.");
      return;
    }
    setBusy(true);
    setCreatedPassword(null);
    setInviteSent(false);
    setInviteError(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-team-user", {
        body: {
          action: "create",
          email: email.trim().toLowerCase(),
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          role,
        },
      });
      if (error) {
        const msg =
          error.message?.includes("Failed to send a request to the Edge Function")
            ? "Team service unavailable — ask ops to deploy admin-create-team-user."
            : error.message;
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      const sent = Boolean((data as any)?.inviteSent);
      setInviteSent(sent);
      setInviteError((data as any)?.inviteError || null);
      setCreatedPassword((data as any)?.password || null);
      setCreatedEmail(email.trim().toLowerCase());
      if (sent) {
        toast.success(
          `Invite email sent to ${email.trim().toLowerCase()} — they can accept and join the workspace.`,
        );
      } else {
        toast.warning(
          "User added, but the invite email could not be sent. Share the fallback password below or resend the invite.",
        );
      }
      setEmail("");
      setFirstName("");
      setLastName("");
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't create team user");
    } finally {
      setBusy(false);
    }
  };

  const resendInvite = async (userId: string, memberEmail: string | null) => {
    setResendingId(userId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-team-user", {
        body: { action: "resend_invite", userId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Invite resent to ${memberEmail || "team member"}`);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't resend invite");
    } finally {
      setResendingId(null);
    }
  };

  const changeRole = async (
    action: "set_role" | "remove_role",
    userId: string,
    targetRole: string,
  ) => {
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-team-user", {
        body: { action, userId, role: targetRole },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Updated");
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't update role");
    }
  };

  if (forbidden) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="py-10 text-center space-y-2">
          <RiShieldStarLine className="w-8 h-8 mx-auto text-amber-600" />
          <p className="font-semibold text-amber-900">Admins only</p>
          <p className="text-sm text-amber-800">
            VA accounts can use the console but only admins can manage team members.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight">
            Team &amp; access
          </h1>
          <p className="text-sm text-slate-500">
            Admins and VAs who can sign into this console. VAs get the same
            workspace; only admins can manage the team.
          </p>
        </div>
        <Button
          variant="outline"
          className="border-slate-200 text-slate-700"
          onClick={() => void load()}
          disabled={loading}
        >
          <RiRefreshLine className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* VA onboarding approval queue (team.novaracleaning.com applicants) */}
      <VaOnboardingQueue />

      {/* Add user */}
      <Card className="border-slate-200">
        <CardContent className="p-4 sm:p-5 space-y-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
            Add a VA or admin
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Work email *</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="assistant@novaracleaning.com"
              />
            </div>
            <div>
              <Label className="text-xs">First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "va" | "admin")}
                className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
              >
                <option value="va">VA (virtual assistant)</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={createUser}
                disabled={busy}
                className="w-full bg-violet-600 hover:bg-violet-700 text-white"
              >
                {busy ? (
                  <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RiUserAddLine className="w-4 h-4 mr-2" />
                )}
                Add to team
              </Button>
            </div>
          </div>
          {inviteSent && createdEmail && (
            <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-xs">
              <p className="font-semibold text-violet-900 mb-1">
                Invite sent to {createdEmail}
              </p>
              <p className="text-violet-800">
                They received an email to accept workspace access at{" "}
                <span className="font-medium">admin.novaracleaning.com</span>. The link
                lets them set a password (new accounts) or sign in (existing accounts).
              </p>
            </div>
          )}
          {!inviteSent && createdEmail && (createdPassword || inviteError) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
              <p className="font-semibold text-amber-900 mb-1">
                Invite email failed for {createdEmail}
              </p>
              {inviteError && (
                <p className="text-amber-800 mb-2">{inviteError}</p>
              )}
              {createdPassword && (
                <>
                  <p className="text-amber-800 mb-1">Fallback temporary password:</p>
                  <p className="font-mono text-sm break-all text-amber-900">{createdPassword}</p>
                  <p className="text-[11px] text-amber-700 mt-2">
                    Share securely, or use Resend invite below once email is configured.
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Team list */}
      <Card className="border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Member</th>
                <th className="text-left px-4 py-3 font-semibold">Roles</th>
                <th className="px-4 py-3"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                    <RiLoader4Line className="w-5 h-5 mx-auto animate-spin" />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                    No team members yet.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isAdmin = u.roles.includes("admin");
                  const isVa = u.roles.includes("va");
                  return (
                    <tr key={u.userId} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{u.email || "—"}</div>
                        <div className="text-[11px] text-slate-500">
                          Added {new Date(u.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {isAdmin && (
                            <Badge
                              variant="outline"
                              className="bg-violet-50 text-violet-700 border-violet-200"
                            >
                              <RiShieldStarLine className="w-3 h-3 mr-1" /> admin
                            </Badge>
                          )}
                          {isVa && (
                            <Badge
                              variant="outline"
                              className="bg-sky-50 text-sky-700 border-sky-200"
                            >
                              <RiUserStarLine className="w-3 h-3 mr-1" /> va
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-sky-200 text-sky-700"
                            disabled={resendingId === u.userId}
                            onClick={() => void resendInvite(u.userId, u.email)}
                          >
                            {resendingId === u.userId ? (
                              <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              "Resend invite"
                            )}
                          </Button>
                          {!isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-violet-200 text-violet-700"
                              onClick={() => changeRole("set_role", u.userId, "admin")}
                            >
                              Make admin
                            </Button>
                          )}
                          {isAdmin && isVa && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-slate-200 text-slate-600"
                              onClick={() => changeRole("remove_role", u.userId, "va")}
                            >
                              Remove VA
                            </Button>
                          )}
                          {isVa && !isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700"
                              onClick={() => {
                                if (confirm(`Revoke VA access for ${u.email}?`)) {
                                  void changeRole("remove_role", u.userId, "va");
                                }
                              }}
                            >
                              <RiDeleteBinLine className="w-3.5 h-3.5 mr-1" />
                              Revoke
                            </Button>
                          )}
                          {isAdmin && !isVa && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700"
                              onClick={() => {
                                if (
                                  confirm(
                                    `Revoke ADMIN access for ${u.email}? They will lose console access.`,
                                  )
                                ) {
                                  void changeRole("remove_role", u.userId, "admin");
                                }
                              }}
                            >
                              <RiDeleteBinLine className="w-3.5 h-3.5 mr-1" />
                              Revoke admin
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── VA onboarding approval queue ───────────────────────────────────────
//
// Applicants from team.novaracleaning.com. The rule: NO access before a
// signed agreement AND approval here. Approve provisions the GHL USER seat
// (role-scoped) + workspace access; Offboard revokes everything in one
// logged action.
interface VaRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  va_role: string;
  timezone: string | null;
  working_hours: string | null;
  experience: string | null;
  tools: string | null;
  status: string;
  agreement_signed_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  provisioned_at: string | null;
  ghl_user_id: string | null;
  created_at: string;
}

const VA_STATUS_TONE: Record<string, string> = {
  started: "bg-slate-100 text-slate-600",
  signed: "bg-blue-100 text-blue-700",
  submitted: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  offboarded: "bg-slate-200 text-slate-600",
};

function VaOnboardingQueue() {
  const [rows, setRows] = useState<VaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const loadRows = async () => {
    setLoading(true);
    const { data, error } = await (supabase.from as any)("va_onboarding")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(`VA queue: ${error.message}`);
    setRows((data as VaRow[]) || []);
    setLoading(false);
  };
  useEffect(() => { void loadRows(); }, []);

  const act = async (row: VaRow, action: "approve" | "reject" | "offboard") => {
    const name = `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email;
    if (action === "approve" && !confirm(
      `Approve ${name}?\n\nThis provisions their access NOW:\n• GoHighLevel USER seat (${row.va_role} role template)\n• Admin Workspace access (va role)\n\nThey'll be emailed their logins.`,
    )) return;
    let reason: string | undefined;
    if (action === "reject") {
      reason = prompt(`Reject ${name}? Optional reason (kept internal):`) ?? undefined;
      if (reason === undefined) return;
    }
    if (action === "offboard" && !confirm(
      `Offboard ${name}?\n\nOne action closes every door:\n• GHL user deleted\n• Workspace roles revoked + login banned\n\nThis is logged.`,
    )) return;

    setWorking(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-va-provision", {
        body: { action, onboardingId: row.id, reason },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if (action === "approve") {
        const d = data as { ghlUserCreated?: boolean; workspaceInviteSent?: boolean; vaEmailSent?: boolean };
        toast.success(
          `Approved & provisioned — GHL user ${d.ghlUserCreated ? "created" : "already existed"}, workspace ${d.workspaceInviteSent ? "invite sent" : "granted"}, VA ${d.vaEmailSent ? "emailed their access" : "email pending"}.`,
        );
      } else if (action === "reject") {
        toast.success("Application rejected — nothing was provisioned.");
      } else {
        const d = data as { ghlDeleted?: boolean; workspaceRevoked?: boolean };
        toast.success(`Offboarded — GHL ${d.ghlDeleted ? "deleted" : "not found"}, workspace ${d.workspaceRevoked ? "revoked" : "n/a"}. Logged.`);
      }
      await loadRows();
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Action failed");
    } finally {
      setWorking(null);
    }
  };

  const pending = rows.filter((r) => r.status === "submitted");
  const inProgress = rows.filter((r) => ["started", "signed"].includes(r.status));
  const active = rows.filter((r) => r.status === "approved");
  const archived = rows.filter((r) => ["rejected", "offboarded"].includes(r.status));

  const renderRow = (r: VaRow) => {
    const name = `${r.first_name || ""} ${r.last_name || ""}`.trim() || r.email;
    return (
      <div key={r.id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {name} <span className="text-slate-400 font-normal">· {r.email}</span>
              {r.phone ? <span className="text-slate-400 font-normal hidden sm:inline"> · {r.phone}</span> : null}
            </p>
            <p className="text-xs text-slate-500">
              {r.va_role} VA{r.timezone ? ` · ${r.timezone}` : ""}{r.working_hours ? ` · ${r.working_hours}` : ""}
              {r.tools ? ` · knows: ${r.tools}` : ""}
            </p>
            {r.experience && <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{r.experience}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <Badge className={cn("text-[11px]", VA_STATUS_TONE[r.status] || "bg-slate-100 text-slate-600")}>
              {r.status}
            </Badge>
            <Badge className={cn("text-[11px]", r.agreement_signed_at ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
              {r.agreement_signed_at ? "Agreement signed ✓" : "NOT signed"}
            </Badge>
            {r.status === "submitted" && (
              <>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={working !== null || !r.agreement_signed_at}
                  onClick={() => act(r, "approve")}>
                  {working === r.id ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : "Approve & provision"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs border-rose-200 text-rose-700"
                  disabled={working !== null}
                  onClick={() => act(r, "reject")}>
                  Reject
                </Button>
              </>
            )}
            {r.status === "approved" && (
              <Button size="sm" variant="outline" className="h-8 text-xs border-rose-200 text-rose-700"
                disabled={working !== null}
                onClick={() => act(r, "offboard")}>
                {working === r.id ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : "Offboard (revoke all)"}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="border-violet-200">
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-violet-700 font-semibold">
              VA onboarding queue
            </p>
            <p className="text-xs text-slate-500">
              Applicants from team.novaracleaning.com. No access is provisioned until the agreement is signed
              AND you approve here.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadRows()} disabled={loading}>
            <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </div>

        {loading ? (
          <div className="py-6 text-center"><RiLoader4Line className="w-5 h-5 animate-spin text-violet-600 mx-auto" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">
            No VA applications yet — send candidates to team.novaracleaning.com.
          </p>
        ) : (
          <div className="space-y-3">
            {pending.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-amber-700">Awaiting your approval ({pending.length})</p>
                {pending.map(renderRow)}
              </div>
            )}
            {active.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-emerald-700">Active VAs ({active.length})</p>
                {active.map(renderRow)}
              </div>
            )}
            {inProgress.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-500">Still onboarding ({inProgress.length})</p>
                {inProgress.map(renderRow)}
              </div>
            )}
            {archived.length > 0 && (
              <div className="space-y-1.5">
                <button type="button" className="text-xs text-slate-400 underline underline-offset-2" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Hide" : "Show"} rejected / offboarded ({archived.length})
                </button>
                {showAll && archived.map(renderRow)}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
