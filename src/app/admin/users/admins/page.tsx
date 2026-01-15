"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Shield,
  UserPlus,
  MoreHorizontal,
  Mail,
  Trash2,
  RefreshCcw,
  ArrowLeft,
  Key,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface AdminUser {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  email?: string;
}

export default function AdminsListPage() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [adminToRemove, setAdminToRemove] = useState<AdminUser | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchAdmins = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .eq("role", "admin")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get emails from auth if possible - since we can't directly query auth.users
      // we'll just use the user_id as a fallback
      const adminsWithEmail = (data || []).map((admin) => ({
        ...admin,
        email: `admin-${admin.user_id.slice(0, 8)}@admin.local`, // Placeholder
      }));

      setAdmins(adminsWithEmail);
    } catch (error) {
      console.error("Error fetching admins:", error);
      toast.error("Failed to load admin users");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleRemoveAdmin = async () => {
    if (!adminToRemove) return;

    // Prevent removing yourself
    if (adminToRemove.user_id === user?.id) {
      toast.error("You cannot remove yourself as an admin");
      setRemoveDialogOpen(false);
      return;
    }

    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("id", adminToRemove.id);

      if (error) throw error;

      toast.success("Admin role removed");
      setRemoveDialogOpen(false);
      setAdminToRemove(null);
      fetchAdmins();
    } catch (error) {
      console.error("Error removing admin:", error);
      toast.error("Failed to remove admin role");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/users">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Admin Users</h1>
          <p className="text-muted-foreground">
            Manage administrator accounts
          </p>
        </div>
        <Button variant="outline" onClick={fetchAdmins}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Link href="/portal/users/admins/invite">
          <Button>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Admin
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Current Admins
          </CardTitle>
          <CardDescription>
            {admins.length} administrator{admins.length !== 1 ? "s" : ""} with system access
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : admins.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No admin users found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((admin) => (
                  <TableRow key={admin.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>
                            <Shield className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium font-mono text-sm">
                            {admin.user_id.slice(0, 8)}...
                          </p>
                          {admin.user_id === user?.id && (
                            <Badge variant="outline" className="text-xs">You</Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="default" className="capitalize">
                        {admin.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(parseISO(admin.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              setAdminToRemove(admin);
                              setRemoveDialogOpen(true);
                            }}
                            disabled={admin.user_id === user?.id}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove Admin
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/portal/users/roles">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-5 w-5" />
                Role Management
              </CardTitle>
              <CardDescription>
                View and manage user roles across the system
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/portal/audit">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Audit Log
              </CardTitle>
              <CardDescription>
                View admin activity and security events
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* Remove Admin Dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Admin Access</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove admin access for this user?
              They will no longer be able to access the admin portal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveAdmin}
              className="bg-red-600 hover:bg-red-700"
              disabled={isProcessing}
            >
              Remove Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
