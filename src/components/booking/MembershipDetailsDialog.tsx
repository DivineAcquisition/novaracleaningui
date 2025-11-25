import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Clock, Sparkles } from "lucide-react";
import { MEMBERSHIP_PLANS } from "@/lib/pricing-system";

interface MembershipDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membershipId: keyof typeof MEMBERSHIP_PLANS;
  onSelect: () => void;
}

export function MembershipDetailsDialog({
  open,
  onOpenChange,
  membershipId,
  onSelect,
}: MembershipDetailsDialogProps) {
  const plan = MEMBERSHIP_PLANS[membershipId];

  if (!plan || membershipId === 'none') return null;

  const handleSelect = () => {
    onSelect();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            {plan.label} Membership
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Price */}
          <div className="text-center">
            <div className="text-4xl font-bold text-primary">
              ${plan.monthlyPrice}
              <span className="text-lg text-muted-foreground">/month</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
          </div>

          {/* Key Benefits */}
          <div className="bg-accent/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-semibold">
                  {plan.cleansPerMonth} {plan.cleansPerMonth === 1 ? 'Clean' : 'Cleans'} per Month
                </div>
                <div className="text-sm text-muted-foreground">
                  Perfect for maintaining a clean home
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-semibold">
                  {plan.includedHours} Hours Included Per Clean
                </div>
                <div className="text-sm text-muted-foreground">
                  Covers most standard cleaning needs
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Check className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-semibold">
                  {Math.round(plan.overtimeDiscount * 100)}% Off Overtime
                </div>
                <div className="text-sm text-muted-foreground">
                  Save when cleans exceed {plan.includedHours} hours
                </div>
              </div>
            </div>
          </div>

          {/* All Features */}
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Everything Included:</h4>
            <ul className="space-y-2">
              {plan.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Savings Example */}
          <div className="bg-muted rounded-lg p-4">
            <div className="text-sm font-semibold mb-2">💰 Example Savings:</div>
            <div className="text-sm text-muted-foreground">
              If a clean takes 4 hours, you pay for:
              <div className="mt-2 space-y-1">
                <div>• First {plan.includedHours} hours: <span className="font-semibold text-foreground">Included</span></div>
                <div>• Next {4 - plan.includedHours} {4 - plan.includedHours === 1 ? 'hour' : 'hours'}: <span className="font-semibold text-primary">{Math.round(plan.overtimeDiscount * 100)}% off</span></div>
              </div>
            </div>
          </div>

          {/* Select Button */}
          <Button 
            onClick={handleSelect}
            className="w-full"
            size="lg"
          >
            Select {plan.label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
