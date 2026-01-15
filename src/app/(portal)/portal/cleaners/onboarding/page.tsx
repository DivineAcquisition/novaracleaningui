"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { format } from "date-fns";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Plus,
  Copy,
  RefreshCcw,
  CheckCircle,
  Clock,
  Key,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface OnboardingPin {
  id: string;
  pin_code: string;
  is_active: boolean;
  created_at: string | null;
  used_at: string | null;
}

export default function CleanerOnboardingPage() {
  const [pins, setPins] = useState<OnboardingPin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newPin, setNewPin] = useState("");

  const fetchPins = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("cleaner_onboarding_pins")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPins(data || []);
    } catch (error) {
      console.error("Error fetching pins:", error);
      toast.error("Failed to load onboarding PINs");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPins();
  }, []);

  const generatePin = () => {
    // Generate a 6-digit PIN
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    setNewPin(pin);
  };

  const createPin = async () => {
    if (!newPin) {
      generatePin();
      return;
    }

    setIsCreating(true);
    try {
      const { error } = await supabase.from("cleaner_onboarding_pins").insert({
        pin_code: newPin,
        is_active: true,
      });

      if (error) throw error;

      toast.success("PIN created successfully");
      setDialogOpen(false);
      setNewPin("");
      fetchPins();
    } catch (error) {
      console.error("Error creating PIN:", error);
      toast.error("Failed to create PIN");
    } finally {
      setIsCreating(false);
    }
  };

  const copyPin = (pin: string) => {
    navigator.clipboard.writeText(pin);
    toast.success("PIN copied to clipboard");
  };

  const deactivatePin = async (id: string) => {
    try {
      const { error } = await supabase
        .from("cleaner_onboarding_pins")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;

      toast.success("PIN deactivated");
      fetchPins();
    } catch (error) {
      console.error("Error deactivating PIN:", error);
      toast.error("Failed to deactivate PIN");
    }
  };

  const activePins = pins.filter((p) => p.is_active && !p.used_at);
  const usedPins = pins.filter((p) => p.used_at);
  const inactivePins = pins.filter((p) => !p.is_active && !p.used_at);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/cleaners">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Cleaner Onboarding</h1>
          <p className="text-muted-foreground">
            Manage onboarding PIN codes for new cleaners
          </p>
        </div>
        <Button variant="outline" onClick={fetchPins}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Generate PIN
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate Onboarding PIN</DialogTitle>
              <DialogDescription>
                Create a new PIN code for a cleaner to use during onboarding
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>PIN Code</Label>
                <div className="flex gap-2">
                  <Input
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    placeholder="Click generate to create a PIN"
                    maxLength={6}
                    className="font-mono text-2xl tracking-widest"
                  />
                  <Button variant="outline" onClick={generatePin}>
                    <Key className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Share this PIN with the cleaner to allow them to register
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createPin} disabled={isCreating || !newPin}>
                {isCreating ? "Creating..." : "Create PIN"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active PINs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activePins.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Used PINs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usedPins.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Deactivated PINs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inactivePins.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Active PINs */}
      <Card>
        <CardHeader>
          <CardTitle>Active PINs</CardTitle>
          <CardDescription>
            PINs that are available for new cleaners to use
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : activePins.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No active PINs. Generate one to onboard a new cleaner.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PIN Code</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activePins.map((pin) => (
                  <TableRow key={pin.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-lg font-mono bg-muted px-2 py-1 rounded">
                          {pin.pin_code}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyPin(pin.pin_code)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      {pin.created_at
                        ? format(new Date(pin.created_at), "MMM d, yyyy h:mm a")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className="gap-1">
                        <Clock className="h-3 w-3" />
                        Pending
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deactivatePin(pin.id)}
                      >
                        Deactivate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Used PINs */}
      {usedPins.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Used PINs</CardTitle>
            <CardDescription>
              PINs that have been used by cleaners to register
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PIN Code</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usedPins.map((pin) => (
                  <TableRow key={pin.id}>
                    <TableCell>
                      <code className="text-lg font-mono bg-muted px-2 py-1 rounded">
                        {pin.pin_code}
                      </code>
                    </TableCell>
                    <TableCell>
                      {pin.created_at
                        ? format(new Date(pin.created_at), "MMM d, yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {pin.used_at
                        ? format(new Date(pin.used_at), "MMM d, yyyy h:mm a")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Used
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
