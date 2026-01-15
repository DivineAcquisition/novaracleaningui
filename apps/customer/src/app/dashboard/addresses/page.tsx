"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  MapPin,
  Plus,
  Edit,
  Trash2,
  Home,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
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

interface Address {
  id: string;
  street: string;
  unit: string | null;
  city: string;
  state: string;
  zip: string;
  sqft_tier: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  is_primary: boolean | null;
}

export default function AddressesPage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [addressToDelete, setAddressToDelete] = useState<Address | null>(null);

  const fetchAddresses = async () => {
    if (!user?.email) return;

    setIsLoading(true);
    try {
      const { data: customer } = await supabase
        .from("customers")
        .select("id")
        .eq("email", user.email)
        .single();

      if (customer) {
        const { data, error } = await supabase
          .from("addresses")
          .select("*")
          .eq("customer_id", customer.id)
          .order("is_primary", { ascending: false });

        if (error) throw error;
        setAddresses(data || []);
      }
    } catch (error) {
      console.error("Error fetching addresses:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAddresses();
  }, [user]);

  const handleDelete = async () => {
    if (!addressToDelete) return;

    try {
      const { error } = await supabase
        .from("addresses")
        .delete()
        .eq("id", addressToDelete.id);

      if (error) throw error;

      toast.success("Address deleted");
      setDeleteDialogOpen(false);
      fetchAddresses();
    } catch (error) {
      console.error("Error deleting address:", error);
      toast.error("Failed to delete address");
    }
  };

  const handleSetPrimary = async (addressId: string) => {
    try {
      // First, unset all primary flags
      await supabase
        .from("addresses")
        .update({ is_primary: false })
        .neq("id", "");

      // Then set the selected address as primary
      const { error } = await supabase
        .from("addresses")
        .update({ is_primary: true })
        .eq("id", addressId);

      if (error) throw error;

      toast.success("Primary address updated");
      fetchAddresses();
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to update primary address");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Saved Addresses</h1>
          <p className="text-muted-foreground">
            Manage your service addresses
          </p>
        </div>
        <Link href="/dashboard/addresses/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Address
          </Button>
        </Link>
      </div>

      {addresses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No addresses saved</h3>
            <p className="text-muted-foreground mb-4">
              Add an address to quickly book cleanings
            </p>
            <Link href="/dashboard/addresses/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Address
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {addresses.map((address) => (
            <Card key={address.id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Home className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{address.street}</p>
                        {address.is_primary && (
                          <Badge variant="secondary">Primary</Badge>
                        )}
                      </div>
                      {address.unit && (
                        <p className="text-sm text-muted-foreground">{address.unit}</p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {address.city}, {address.state} {address.zip}
                      </p>
                      {(address.bedrooms || address.bathrooms) && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {address.bedrooms && `${address.bedrooms} bed`}
                          {address.bedrooms && address.bathrooms && " • "}
                          {address.bathrooms && `${address.bathrooms} bath`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 mt-4">
                  {!address.is_primary && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSetPrimary(address.id)}
                    >
                      Set Primary
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAddressToDelete(address);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Address</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this address? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
