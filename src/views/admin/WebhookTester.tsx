"use client";

import {
  RiArrowLeftLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiFileCopyLine,
  RiLoader4Line,
  RiSendPlaneLine
} from "@remixicon/react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

import { ScrollArea } from "@/components/ui/scroll-area";
import Link from "next/link";
import { SEO } from "@/components/SEO";

interface WebhookResponse {
  success: boolean;
  payload: any;
  timestamp: string;
  bookingId: string;
}

const WebhookTester = () => {
  const [bookingId, setBookingId] = useState("");
  const [loading, setLoading] = useState(false);
  const [responses, setResponses] = useState<WebhookResponse[]>([]);

  const handleTestWebhook = async () => {
    if (!bookingId.trim()) {
      toast.error("Please enter a booking ID");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-zapier-webhook", {
        body: { bookingId: bookingId.trim() },
      });

      if (error) throw error;

      const response: WebhookResponse = {
        success: true,
        payload: data,
        timestamp: new Date().toISOString(),
        bookingId: bookingId.trim(),
      };

      setResponses([response, ...responses]);
      toast.success("Webhook sent successfully!");
    } catch (error: any) {
      const response: WebhookResponse = {
        success: false,
        payload: { error: error.message },
        timestamp: new Date().toISOString(),
        bookingId: bookingId.trim(),
      };
      setResponses([response, ...responses]);
      toast.error("Webhook failed", { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const copyPayload = (payload: any) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast.success("Payload copied to clipboard");
  };

  const clearResponses = () => {
    setResponses([]);
    toast.success("History cleared");
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <SEO title="Webhook Tester" noindex />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/webhooks">
            <Button variant="ghost" size="sm">
              <RiArrowLeftLine className="h-4 w-4 mr-2" />
              Back to Monitor
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold font-jakarta">Webhook Tester</h1>
            <p className="text-muted-foreground mt-1">
              Test webhook payloads by booking ID
            </p>
          </div>
        </div>
      </div>

      {/* Test Form */}
      <Card>
        <CardHeader>
          <CardTitle>Test Webhook with Booking ID</CardTitle>
          <CardDescription>
            Enter a booking ID to send its data to the configured Zapier webhook and inspect the payload
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="bookingId" className="sr-only">Booking ID</Label>
              <Input
                id="bookingId"
                placeholder="Enter booking ID (e.g., 5592596a-9e96-4923-b870-219c816e1241)"
                value={bookingId}
                onChange={(e) => setBookingId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleTestWebhook()}
              />
            </div>
            <Button onClick={handleTestWebhook} disabled={loading}>
              {loading ? (
                <RiLoader4Line className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RiSendPlaneLine className="h-4 w-4 mr-2" />
              )}
              Send Webhook
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Response History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>Webhook Response History</CardTitle>
            <CardDescription>
              View payloads sent to Zapier for inspection
            </CardDescription>
          </div>
          {responses.length > 0 && (
            <Button onClick={clearResponses} variant="outline" size="sm">
              Clear History
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {responses.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No webhooks sent yet. Enter a booking ID above to test.
            </div>
          ) : (
            <ScrollArea className="h-[600px] pr-4">
              <div className="space-y-4">
                {responses.map((response, index) => (
                  <Card key={index} className="border-2">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {response.success ? (
                            <RiCheckboxCircleLine className="h-5 w-5 text-green-500" />
                          ) : (
                            <RiCloseCircleLine className="h-5 w-5 text-red-500" />
                          )}
                          <Badge variant={response.success ? "default" : "destructive"}>
                            {response.success ? "Success" : "Failed"}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {new Date(response.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <Button
                          onClick={() => copyPayload(response.payload)}
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                        >
                          <RiFileCopyLine className="h-4 w-4" />
                          Copy
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        Booking: {response.bookingId}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-4 rounded-md overflow-x-auto text-xs max-h-[400px]">
                        <code>{JSON.stringify(response.payload, null, 2)}</code>
                      </pre>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Field Reference */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook Payload Field Reference</CardTitle>
          <CardDescription>
            All fields included in the Zapier webhook payload
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-2">Customer & Booking</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Customer Name, Email, Phone</li>
                <li>• Booking ID, Booking Number</li>
                <li>• Customer Referral Code</li>
                <li>• Service Address (Street, City, State, ZIP)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Service Details</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Service Type (Standard, Deep, Move-In/Out)</li>
                <li>• Home Size, Square Footage Range</li>
                <li>• Dwelling Type, Bedrooms, Bathrooms</li>
                <li>• Frequency, Estimated Duration Hours</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Scheduling</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Service Date, Time Slot</li>
                <li>• Service Start Date Formatted (MM-DD-YYYY)</li>
                <li>• Service Start Time Formatted (HH:MM AM/PM)</li>
                <li>• Service Start DateTime (Combined)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Pricing & Payment</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Total Estimate, Deposit Amount</li>
                <li>• Discounted Amount (Cash saved)</li>
                <li>• Deposit Type (Paid In Full, $39 Only, etc.)</li>
                <li>• Payment Method, Paid in Full flag</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Team & Payouts</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Team Size (2 or 3 cleaners)</li>
                <li>• Cleaner Hourly Rate ($18/hr base)</li>
                <li>• Cleaner Payout Per Cleaner</li>
                <li>• Total Team Payout, Company Net</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Operations</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Booking Channel, Booker Source</li>
                <li>• Status, Access Notes, Team Notes</li>
                <li>• Membership Plan, Uses Credit</li>
                <li>• Created At timestamp</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default WebhookTester;
