import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, CreditCard, Calendar, LogOut, Settings, Loader2, CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function Account() {
  const navigate = useNavigate();
  const { user, subscription, signOut, checkSubscription, openCustomerPortal, resetPassword } = useAuth();
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
    } else {
      checkSubscription();
    }
  }, [user, navigate]);

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out successfully");
    navigate("/");
  };

  const handleManageSubscription = async () => {
    try {
      await openCustomerPortal();
    } catch (error: any) {
      toast.error(error.message || "Failed to open customer portal");
    }
  };

  const handleChangePassword = async () => {
    if (!user?.email) return;
    
    setIsResettingPassword(true);
    const { error } = await resetPassword(user.email);
    
    if (error) {
      toast.error(error.message || "Failed to send reset email");
    } else {
      toast.success("Password reset link sent to your email!");
    }
    
    setIsResettingPassword(false);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">My Account</h1>
          <p className="text-muted-foreground">Manage your profile and subscriptions</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Profile Card */}
          <Card className="border-primary/20">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center shadow-lavender">
                  <User className="w-6 h-6 text-white" />
                </div>
                <div>
                  <CardTitle>Profile</CardTitle>
                  <CardDescription>Your account information</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{user.email}</p>
              </div>
              <Separator />
              <Button
                variant="outline"
                className="w-full"
                onClick={handleChangePassword}
                disabled={isResettingPassword}
              >
                {isResettingPassword ? (
                  <>
                    <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                    Sending reset link...
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 w-4 h-4" />
                    Change Password
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSignOut}
              >
                <LogOut className="mr-2 w-4 h-4" />
                Sign Out
              </Button>
            </CardContent>
          </Card>

          {/* Subscription Card */}
          <Card className="border-primary/20">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center shadow-lavender">
                  <CreditCard className="w-6 h-6 text-white" />
                </div>
                <div>
                  <CardTitle>Subscription</CardTitle>
                  <CardDescription>Your current plan</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {subscription?.subscribed ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{subscription.plan_name}</p>
                      <p className="text-sm text-muted-foreground">
                        Status: <Badge variant="default" className="ml-1">Active</Badge>
                      </p>
                    </div>
                    <CheckCircle2 className="w-8 h-8 text-success" />
                  </div>
                  
                  {subscription.subscription_end && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span>
                        Renews {format(new Date(subscription.subscription_end), "MMM d, yyyy")}
                      </span>
                    </div>
                  )}
                  
                  <Separator />
                  
                  <Button
                    className="w-full bg-gradient-primary hover:opacity-90"
                    onClick={handleManageSubscription}
                  >
                    <Settings className="mr-2 w-4 h-4" />
                    Manage Subscription
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-center py-6">
                    <p className="text-muted-foreground mb-4">
                      {subscription?.hasCustomer 
                        ? "No active subscription"
                        : "Start your cleaning journey"}
                    </p>
                    <Button
                      className="bg-gradient-primary hover:opacity-90 shadow-lavender"
                      onClick={() => navigate("/book/zip")}
                    >
                      Book Your First Cleaning
                    </Button>
                  </div>
                  
                  {subscription?.hasCustomer && (
                    <>
                      <Separator />
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleManageSubscription}
                      >
                        <Settings className="mr-2 w-4 h-4" />
                        View Billing History
                      </Button>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card className="mt-6 border-primary/20">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <Button
                variant="outline"
                className="h-auto py-4 justify-start"
                onClick={() => navigate("/book/zip")}
              >
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-primary mt-0.5" />
                  <div className="text-left">
                    <p className="font-semibold">Book a Cleaning</p>
                    <p className="text-xs text-muted-foreground">Schedule your next service</p>
                  </div>
                </div>
              </Button>
              
              {subscription?.hasCustomer && (
                <Button
                  variant="outline"
                  className="h-auto py-4 justify-start"
                  onClick={handleManageSubscription}
                >
                  <div className="flex items-start gap-3">
                    <CreditCard className="w-5 h-5 text-primary mt-0.5" />
                    <div className="text-left">
                      <p className="font-semibold">Payment Methods</p>
                      <p className="text-xs text-muted-foreground">Update your billing info</p>
                    </div>
                  </div>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
