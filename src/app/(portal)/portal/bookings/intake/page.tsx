"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarIcon,
  User,
  MapPin,
  Home,
  Clock,
  CreditCard,
  Loader2,
  Search,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const HOME_SIZES = [
  { id: "studio_1br", label: "Studio - 1 BR (up to 800 sq ft)", sqft: 800 },
  { id: "2br", label: "2 BR (800 - 1200 sq ft)", sqft: 1200 },
  { id: "3br", label: "3 BR (1200 - 1800 sq ft)", sqft: 1800 },
  { id: "4br", label: "4 BR (1800 - 2500 sq ft)", sqft: 2500 },
  { id: "5br_plus", label: "5+ BR (2500+ sq ft)", sqft: 3000 },
];

const SERVICE_TYPES = [
  { value: "standard", label: "Standard Clean" },
  { value: "deep", label: "Deep Clean" },
  { value: "move_in_out", label: "Move In/Out" },
];

const ADD_ONS = [
  { id: "inside_fridge", label: "Inside Fridge" },
  { id: "inside_oven", label: "Inside Oven" },
  { id: "inside_cabinets", label: "Inside Cabinets" },
  { id: "laundry", label: "Laundry (wash & fold)" },
  { id: "windows", label: "Interior Windows" },
  { id: "organization", label: "Organization" },
];

const TIME_SLOTS = [
  "8:00 AM - 10:00 AM",
  "9:00 AM - 11:00 AM",
  "10:00 AM - 12:00 PM",
  "11:00 AM - 1:00 PM",
  "12:00 PM - 2:00 PM",
  "1:00 PM - 3:00 PM",
  "2:00 PM - 4:00 PM",
  "3:00 PM - 5:00 PM",
];

const formSchema = z.object({
  // Customer Info
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number is required"),
  
  // Address
  address: z.string().min(1, "Address is required"),
  unit: z.string().optional(),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zipCode: z.string().min(5, "ZIP code is required"),
  accessNotes: z.string().optional(),
  
  // Property
  homeSize: z.string().min(1, "Home size is required"),
  bedrooms: z.number().optional(),
  bathrooms: z.number().optional(),
  dwellingType: z.string().optional(),
  flooringType: z.string().optional(),
  hasPets: z.boolean().default(false),
  petDetails: z.string().optional(),
  
  // Service
  serviceType: z.string().min(1, "Service type is required"),
  addOns: z.array(z.string()).default([]),
  specialInstructions: z.string().optional(),
  
  // Schedule
  serviceDate: z.date({ required_error: "Service date is required" }),
  timeSlot: z.string().min(1, "Time slot is required"),
  
  // Payment
  paymentMethod: z.enum(["card", "invoice", "cash"]),
  promoCode: z.string().optional(),
  
  // Source
  bookingChannel: z.string().optional(),
  referralCode: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function BookingIntakePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingCustomer, setExistingCustomer] = useState<any>(null);
  const [estimatedPrice, setEstimatedPrice] = useState<number>(0);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      address: "",
      unit: "",
      city: "",
      state: "",
      zipCode: "",
      accessNotes: "",
      homeSize: "",
      bedrooms: undefined,
      bathrooms: undefined,
      dwellingType: "",
      flooringType: "",
      hasPets: false,
      petDetails: "",
      serviceType: "standard",
      addOns: [],
      specialInstructions: "",
      serviceDate: undefined,
      timeSlot: "",
      paymentMethod: "card",
      promoCode: "",
      bookingChannel: "phone",
      referralCode: "",
    },
  });

  const watchHomeSize = form.watch("homeSize");
  const watchServiceType = form.watch("serviceType");
  const watchAddOns = form.watch("addOns");

  // Calculate estimated price
  useEffect(() => {
    let basePrice = 0;
    const homeSize = HOME_SIZES.find((s) => s.id === watchHomeSize);
    
    if (homeSize) {
      // Base prices (in cents)
      const basePrices: Record<string, number> = {
        studio_1br: 12900,
        "2br": 16900,
        "3br": 19900,
        "4br": 24900,
        "5br_plus": 29900,
      };
      
      basePrice = basePrices[homeSize.id] || 0;
      
      // Service type multipliers
      if (watchServiceType === "deep") {
        basePrice *= 1.5;
      } else if (watchServiceType === "move_in_out") {
        basePrice *= 1.75;
      }
      
      // Add-ons (rough estimates)
      const addOnPrices: Record<string, number> = {
        inside_fridge: 2500,
        inside_oven: 2500,
        inside_cabinets: 3500,
        laundry: 3500,
        windows: 4500,
        organization: 5000,
      };
      
      watchAddOns.forEach((addon) => {
        basePrice += addOnPrices[addon] || 0;
      });
    }
    
    setEstimatedPrice(basePrice);
  }, [watchHomeSize, watchServiceType, watchAddOns]);

  const searchCustomer = async (email: string) => {
    if (!email || !email.includes("@")) return;
    
    const { data } = await supabase
      .from("customers")
      .select("*")
      .eq("email", email)
      .single();
    
    if (data) {
      setExistingCustomer(data);
      // Auto-fill customer info
      form.setValue("firstName", data.first_name);
      form.setValue("lastName", data.last_name);
      form.setValue("phone", data.phone || "");
      if (data.address) form.setValue("address", data.address);
      if (data.city) form.setValue("city", data.city);
      if (data.state) form.setValue("state", data.state);
      if (data.zip) form.setValue("zipCode", data.zip);
      toast.success("Existing customer found!");
    } else {
      setExistingCustomer(null);
    }
  };

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    
    try {
      const homeSize = HOME_SIZES.find((s) => s.id === values.homeSize);
      
      // Create the booking
      const { data: booking, error } = await supabase
        .from("bookings")
        .insert({
          first_name: values.firstName,
          last_name: values.lastName,
          email: values.email,
          phone: values.phone,
          address: values.address,
          city: values.city,
          state: values.state,
          zip_code: values.zipCode,
          access_notes: values.accessNotes || null,
          home_size_id: values.homeSize,
          sqft: homeSize?.sqft || null,
          bedrooms: values.bedrooms || null,
          bathrooms: values.bathrooms || null,
          dwelling_type: values.dwellingType || null,
          flooring_type: values.flooringType || null,
          pets: values.hasPets ? values.petDetails || "Yes" : null,
          service_type: values.serviceType,
          add_ons: values.addOns.length > 0 ? values.addOns : null,
          team_notes: values.specialInstructions || null,
          service_date: format(values.serviceDate, "yyyy-MM-dd"),
          time_slot: values.timeSlot,
          payment_method: values.paymentMethod,
          booking_channel: values.bookingChannel || "phone",
          base_price_cents: estimatedPrice,
          deposit_cents: Math.round(estimatedPrice * 0.5),
          total_estimate_cents: estimatedPrice,
          status: "confirmed",
        })
        .select()
        .single();

      if (error) throw error;

      // Create or update customer record
      const { error: customerError } = await supabase
        .from("customers")
        .upsert({
          email: values.email,
          first_name: values.firstName,
          last_name: values.lastName,
          phone: values.phone,
          address: values.address,
          city: values.city,
          state: values.state,
          zip: values.zipCode,
        }, {
          onConflict: "email",
        });

      if (customerError) {
        console.error("Error creating customer:", customerError);
      }

      toast.success("Booking created successfully!");
      router.push(`/portal/bookings/${booking.id}`);
    } catch (error) {
      console.error("Error creating booking:", error);
      toast.error("Failed to create booking");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/bookings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Manual Booking Intake</h1>
          <p className="text-muted-foreground">
            Create a new booking for phone or walk-in customers
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              {/* Customer Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Customer Information
                  </CardTitle>
                  <CardDescription>
                    Search by email to auto-fill existing customer details
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>Email</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input
                                placeholder="customer@example.com"
                                {...field}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => searchCustomer(field.value)}
                            >
                              <Search className="h-4 w-4" />
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Name</FormLabel>
                          <FormControl>
                            <Input placeholder="John" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Doe" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input placeholder="(555) 123-4567" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Service Address */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Service Address
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>Street Address</FormLabel>
                          <FormControl>
                            <Input placeholder="123 Main St" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="unit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unit/Apt (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="Apt 4B" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input placeholder="San Francisco" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select state" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="CA">California</SelectItem>
                              <SelectItem value="TX">Texas</SelectItem>
                              <SelectItem value="NY">New York</SelectItem>
                              <SelectItem value="FL">Florida</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="zipCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ZIP Code</FormLabel>
                          <FormControl>
                            <Input placeholder="94102" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="accessNotes"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>Access Notes (Optional)</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Gate code, parking instructions, etc."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Property Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Home className="h-5 w-5" />
                    Property Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="homeSize"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Home Size</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select home size" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {HOME_SIZES.map((size) => (
                              <SelectItem key={size.id} value={size.id}>
                                {size.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-4 sm:grid-cols-4">
                    <FormField
                      control={form.control}
                      name="bedrooms"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bedrooms</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              {...field}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value
                                    ? parseInt(e.target.value)
                                    : undefined
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="bathrooms"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bathrooms</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              step={0.5}
                              {...field}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value
                                    ? parseFloat(e.target.value)
                                    : undefined
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dwellingType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dwelling Type</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="house">House</SelectItem>
                              <SelectItem value="apartment">Apartment</SelectItem>
                              <SelectItem value="condo">Condo</SelectItem>
                              <SelectItem value="townhouse">Townhouse</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="flooringType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Flooring Type</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="hardwood">Hardwood</SelectItem>
                              <SelectItem value="carpet">Carpet</SelectItem>
                              <SelectItem value="tile">Tile</SelectItem>
                              <SelectItem value="mixed">Mixed</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <FormField
                      control={form.control}
                      name="hasPets"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Has pets</FormLabel>
                        </FormItem>
                      )}
                    />
                    {form.watch("hasPets") && (
                      <FormField
                        control={form.control}
                        name="petDetails"
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input
                                placeholder="Pet type and details"
                                {...field}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Service Selection */}
              <Card>
                <CardHeader>
                  <CardTitle>Service Selection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="serviceType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Type</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            value={field.value}
                            className="grid gap-4 sm:grid-cols-3"
                          >
                            {SERVICE_TYPES.map((type) => (
                              <div
                                key={type.value}
                                className={cn(
                                  "flex items-center space-x-2 rounded-lg border p-4 cursor-pointer hover:border-primary",
                                  field.value === type.value && "border-primary bg-primary/5"
                                )}
                              >
                                <RadioGroupItem value={type.value} id={type.value} />
                                <Label htmlFor={type.value}>{type.label}</Label>
                              </div>
                            ))}
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addOns"
                    render={() => (
                      <FormItem>
                        <FormLabel>Add-ons</FormLabel>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {ADD_ONS.map((addon) => (
                            <FormField
                              key={addon.id}
                              control={form.control}
                              name="addOns"
                              render={({ field }) => (
                                <FormItem className="flex items-center space-x-2">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(addon.id)}
                                      onCheckedChange={(checked) => {
                                        if (checked) {
                                          field.onChange([...field.value, addon.id]);
                                        } else {
                                          field.onChange(
                                            field.value?.filter((v) => v !== addon.id)
                                          );
                                        }
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="!mt-0 font-normal">
                                    {addon.label}
                                  </FormLabel>
                                </FormItem>
                              )}
                            />
                          ))}
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="specialInstructions"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Special Instructions (Optional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Any special requests or instructions..."
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Scheduling */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Scheduling
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="serviceDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Service Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {field.value
                                    ? format(field.value, "PPP")
                                    : "Select date"}
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) =>
                                  date < new Date() || date < new Date("1900-01-01")
                                }
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="timeSlot"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Time Slot</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select time slot" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {TIME_SLOTS.map((slot) => (
                                <SelectItem key={slot} value={slot}>
                                  {slot}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Payment & Source */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Payment & Source
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="paymentMethod"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payment Method</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="card">Credit Card</SelectItem>
                              <SelectItem value="invoice">Invoice</SelectItem>
                              <SelectItem value="cash">Cash</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="promoCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Promo Code (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="SAVE20" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="bookingChannel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Booking Channel</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="phone">Phone</SelectItem>
                              <SelectItem value="walk-in">Walk-in</SelectItem>
                              <SelectItem value="referral">Referral</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="referralCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Referral Code (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="REF123" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Pricing Sidebar */}
            <div className="space-y-6">
              <Card className="sticky top-6">
                <CardHeader>
                  <CardTitle>Price Estimate</CardTitle>
                  <CardDescription>
                    Auto-calculated based on selections
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-4xl font-bold text-center py-4">
                    {formatCurrency(estimatedPrice)}
                  </div>
                  
                  <Separator />
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Home Size</span>
                      <span>
                        {HOME_SIZES.find((s) => s.id === watchHomeSize)?.label.split(" ")[0] || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Service Type</span>
                      <span className="capitalize">{watchServiceType || "—"}</span>
                    </div>
                    {watchAddOns.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Add-ons</span>
                        <span>{watchAddOns.length} selected</span>
                      </div>
                    )}
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Deposit (50%)</span>
                      <span>{formatCurrency(estimatedPrice * 0.5)}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>Balance Due</span>
                      <span>{formatCurrency(estimatedPrice * 0.5)}</span>
                    </div>
                  </div>
                  
                  <Button
                    type="submit"
                    className="w-full"
                    size="lg"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating Booking...
                      </>
                    ) : (
                      "Create Booking"
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
