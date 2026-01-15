"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Save,
  UserCog,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";

interface CleanerData {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: string;
  home_zip: string | null;
  service_zip_codes: string[] | null;
  max_travel_miles: number | null;
  pay_rate_hr: number;
}

export default function EditCleanerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [cleaner, setCleaner] = useState<CleanerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newZipCode, setNewZipCode] = useState("");

  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    status: "active",
    home_zip: "",
    service_zip_codes: [] as string[],
    max_travel_miles: "",
    pay_rate_hr: "",
  });

  useEffect(() => {
    const fetchCleaner = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("cleaners")
          .select("*")
          .eq("id", resolvedParams.id)
          .single();

        if (error) throw error;

        setCleaner(data);
        setFormData({
          first_name: data.first_name || "",
          last_name: data.last_name || "",
          email: data.email || "",
          phone: data.phone || "",
          status: data.status || "active",
          home_zip: data.home_zip || "",
          service_zip_codes: data.service_zip_codes || [],
          max_travel_miles: data.max_travel_miles?.toString() || "",
          pay_rate_hr: data.pay_rate_hr?.toString() || "35",
        });
      } catch (error) {
        console.error("Error fetching cleaner:", error);
        toast.error("Failed to load cleaner");
      } finally {
        setIsLoading(false);
      }
    };

    fetchCleaner();
  }, [resolvedParams.id]);

  const handleAddZipCode = () => {
    if (newZipCode && !formData.service_zip_codes.includes(newZipCode)) {
      setFormData({
        ...formData,
        service_zip_codes: [...formData.service_zip_codes, newZipCode],
      });
      setNewZipCode("");
    }
  };

  const handleRemoveZipCode = (zip: string) => {
    setFormData({
      ...formData,
      service_zip_codes: formData.service_zip_codes.filter((z) => z !== zip),
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const { error } = await supabase
        .from("cleaners")
        .update({
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email,
          phone: formData.phone,
          status: formData.status,
          home_zip: formData.home_zip || null,
          service_zip_codes: formData.service_zip_codes.length > 0 ? formData.service_zip_codes : null,
          max_travel_miles: formData.max_travel_miles ? parseInt(formData.max_travel_miles) : null,
          pay_rate_hr: formData.pay_rate_hr ? parseFloat(formData.pay_rate_hr) : 35,
        })
        .eq("id", resolvedParams.id);

      if (error) throw error;

      toast.success("Cleaner updated successfully");
      router.push(`/portal/users/cleaners/${resolvedParams.id}`);
    } catch (error) {
      console.error("Error updating cleaner:", error);
      toast.error("Failed to update cleaner");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!cleaner) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg font-medium text-muted-foreground">
          Cleaner not found
        </p>
        <Link href="/portal/users/cleaners" className="mt-4">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Cleaners
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href={`/portal/users/cleaners/${resolvedParams.id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit Cleaner</h1>
          <p className="text-muted-foreground">
            Update cleaner information and settings
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            Cleaner Details
          </CardTitle>
          <CardDescription>
            Edit the cleaner's profile and service settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first_name">First Name</Label>
                <Input
                  id="first_name"
                  value={formData.first_name}
                  onChange={(e) =>
                    setFormData({ ...formData, first_name: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  value={formData.last_name}
                  onChange={(e) =>
                    setFormData({ ...formData, last_name: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) =>
                    setFormData({ ...formData, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay_rate_hr">Pay Rate ($/hr)</Label>
                <Input
                  id="pay_rate_hr"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.pay_rate_hr}
                  onChange={(e) =>
                    setFormData({ ...formData, pay_rate_hr: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="home_zip">Home ZIP Code</Label>
                <Input
                  id="home_zip"
                  value={formData.home_zip}
                  onChange={(e) =>
                    setFormData({ ...formData, home_zip: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max_travel_miles">Max Travel Distance (miles)</Label>
                <Input
                  id="max_travel_miles"
                  type="number"
                  min="0"
                  value={formData.max_travel_miles}
                  onChange={(e) =>
                    setFormData({ ...formData, max_travel_miles: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Service ZIP Codes</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Add ZIP code"
                  value={newZipCode}
                  onChange={(e) => setNewZipCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddZipCode();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={handleAddZipCode}>
                  Add
                </Button>
              </div>
              {formData.service_zip_codes.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.service_zip_codes.map((zip) => (
                    <Badge key={zip} variant="secondary" className="gap-1">
                      {zip}
                      <button
                        type="button"
                        onClick={() => handleRemoveZipCode(zip)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Changes
              </Button>
              <Link href={`/portal/users/cleaners/${resolvedParams.id}`}>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
