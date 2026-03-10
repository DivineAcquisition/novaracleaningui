"use client";

import {
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiDeleteBinLine,
  RiFileCopyLine
} from "@remixicon/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWebhookHistory } from "@/contexts/WebhookHistoryContext";

import { toast } from "sonner";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";

export const WebhookPayloadInspector = () => {
  const { history, clearHistory } = useWebhookHistory();

  const copyToClipboard = (payload: any) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast.success("Payload copied to clipboard");
  };

  const maskUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/");
      const lastPart = pathParts[pathParts.length - 1];
      return `${urlObj.host}/.../${lastPart.slice(-8)}`;
    } catch {
      return "Invalid URL";
    }
  };

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Webhook Payload Inspector</CardTitle>
          <CardDescription>
            No webhooks sent yet. Send a test webhook to see the payload and response.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle>Webhook Payload Inspector</CardTitle>
          <CardDescription>
            View the exact JSON payload sent to Zapier and responses received
          </CardDescription>
        </div>
        <Button
          onClick={clearHistory}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RiDeleteBinLine className="h-4 w-4" />
          Clear History
        </Button>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          <div className="space-y-4">
            {history.map((entry) => (
              <Card key={entry.id} className="border-2">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={entry.type === "test" ? "secondary" : "default"}>
                        {entry.type}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(entry.timestamp), "MMM d, h:mm:ss a")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.response.status >= 200 && entry.response.status < 300 ? (
                        <RiCheckboxCircleLine className="h-4 w-4 text-green-500" />
                      ) : (
                        <RiCloseCircleLine className="h-4 w-4 text-red-500" />
                      )}
                      <Badge variant={entry.response.status >= 200 && entry.response.status < 300 ? "default" : "destructive"}>
                        {entry.response.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Destination: {maskUrl(entry.webhookUrl)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold">Request Payload</h4>
                      <Button
                        onClick={() => copyToClipboard(entry.payload)}
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1"
                      >
                        <RiFileCopyLine className="h-3 w-3" />
                        Copy
                      </Button>
                    </div>
                    <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs">
                      <code>{JSON.stringify(entry.payload, null, 2)}</code>
                    </pre>
                  </div>

                  {entry.response.body && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Zapier Response</h4>
                      <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs">
                        <code>{entry.response.body}</code>
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
