"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldX, ArrowLeft } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <Card className="max-w-md w-full bg-slate-800/50 border-slate-700">
        <CardContent className="pt-8 text-center space-y-4">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
            <ShieldX className="h-8 w-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-white">Access Denied</h1>
          <p className="text-slate-400">
            You do not have permission to access this area. Please contact your administrator
            if you believe this is an error.
          </p>
          <Link href="/admin/login">
            <Button variant="outline" className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Login
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
