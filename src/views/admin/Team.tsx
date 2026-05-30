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
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setCreatedPassword((data as any)?.password || null);
      setCreatedEmail(email.trim().toLowerCase());
      toast.success(
        (data as any)?.reusedExistingLogin
          ? "Existing account granted portal access — temp password reset below."
          : `${role === "admin" ? "Admin" : "VA"} created — share the temp password below.`,
      );
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
                className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
              >
                <option value="va">VA (virtual assistant)</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={createUser}
                disabled={busy}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
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
          {createdPassword && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs">
              <p className="font-semibold text-emerald-900 mb-1">
                Temporary password for {createdEmail}
              </p>
              <p className="font-mono text-sm break-all text-emerald-900">{createdPassword}</p>
              <p className="text-[11px] text-emerald-700 mt-2">
                Share this securely. They sign in at the admin console and should
                change it from their account settings.
              </p>
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
                              className="bg-emerald-50 text-emerald-700 border-emerald-200"
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
                          {!isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-200 text-emerald-700"
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
