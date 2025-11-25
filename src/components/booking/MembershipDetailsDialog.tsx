import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Check, Clock, Sparkles, Crown } from "lucide-react";
import { MEMBERSHIP_PLANS } from "@/lib/pricing-system";
import { cn } from "@/lib/utils";

interface MembershipDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedMembership: string;
  onSelect: (membershipId: keyof typeof MEMBERSHIP_PLANS) => void;
}

export function MembershipDetailsDialog({
  open,
  onOpenChange,
  selectedMembership,
  onSelect,
}: MembershipDetailsDialogProps) {

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <Crown className="w-6 h-6 text-primary" />
            Choose Your Membership Plan
          </DialogTitle>
          <p className="text-sm text-muted-foreground text-center mt-2">
            Save more with monthly plans or pay as you go
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {/* Pay Per Clean */}
          <Card
            className={cn(
              "p-6 cursor-pointer transition-all hover:shadow-lg",
              selectedMembership === 'none' && "ring-2 ring-primary"
            )}
            onClick={() => onSelect('none')}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold">Pay Per Clean</h3>
                <p className="text-sm text-muted-foreground">No commitment</p>
              </div>
              {selectedMembership === 'none' && (
                <Check className="w-6 h-6 text-primary" />
              )}
            </div>
            <div className="text-3xl font-bold mb-4">
              $0<span className="text-lg text-muted-foreground">/month</span>
            </div>
            <ul className="space-y-2">
              <li className="flex items-start gap-2 text-sm">
                <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <span>Pay only for services you book</span>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <span>No monthly fees</span>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <span>Cancel anytime</span>
              </li>
            </ul>
          </Card>

          {/* Essential Plan */}
          {(Object.keys(MEMBERSHIP_PLANS) as Array<keyof typeof MEMBERSHIP_PLANS>)
            .filter(key => key !== 'none')
            .map((planId) => {
              const plan = MEMBERSHIP_PLANS[planId];
              return (
                <Card
                  key={planId}
                  className={cn(
                    "p-6 cursor-pointer transition-all hover:shadow-lg relative",
                    selectedMembership === planId && "ring-2 ring-primary"
                  )}
                  onClick={() => onSelect(planId)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold">{plan.label}</h3>
                      <p className="text-sm text-muted-foreground">{plan.description}</p>
                    </div>
                    {selectedMembership === planId && (
                      <Check className="w-6 h-6 text-primary" />
                    )}
                  </div>
                  <div className="text-3xl font-bold mb-4">
                    ${plan.monthlyPrice}
                    <span className="text-lg text-muted-foreground">/month</span>
                  </div>

                  <div className="space-y-3 mb-4">
                    <div className="flex items-center gap-3 bg-accent/50 rounded-lg p-3">
                      <Sparkles className="w-5 h-5 text-primary flex-shrink-0" />
                      <div>
                        <div className="font-semibold text-sm">
                          {plan.cleansPerMonth} {plan.cleansPerMonth === 1 ? 'Clean' : 'Cleans'}/Month
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 bg-accent/50 rounded-lg p-3">
                      <Clock className="w-5 h-5 text-primary flex-shrink-0" />
                      <div>
                        <div className="font-semibold text-sm">
                          {plan.includedHours} Hours Included
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 bg-accent/50 rounded-lg p-3">
                      <Check className="w-5 h-5 text-primary flex-shrink-0" />
                      <div>
                        <div className="font-semibold text-sm">
                          {Math.round(plan.overtimeDiscount * 100)}% Off Overtime
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <p className="text-xs text-muted-foreground">
                      💰 Example: 4-hour clean = First {plan.includedHours}hrs included + {4 - plan.includedHours}hr at {Math.round(plan.overtimeDiscount * 100)}% off
                    </p>
                  </div>
                </Card>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
