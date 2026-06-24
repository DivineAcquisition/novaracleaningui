import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Clock, Sparkles, Crown, X } from "lucide-react";
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

  const handleSelect = (membershipId: keyof typeof MEMBERSHIP_PLANS) => {
    onSelect(membershipId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {/* Header */}
        <DialogHeader className="p-4 md:p-6 pb-3 md:pb-4 border-b sticky top-0 bg-background z-10">
          <DialogTitle className="text-xl md:text-2xl font-bold flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Crown className="w-5 h-5 md:w-6 md:h-6 text-primary" />
              Choose Your Plan
            </span>
          </DialogTitle>
          <p className="text-xs md:text-sm text-muted-foreground mt-2">
            Save more with monthly plans or pay as you go
          </p>
        </DialogHeader>

        <div className="p-4 md:p-6 space-y-3 md:space-y-4">
          {/* Pay Per Clean */}
          <Card
            className={cn(
              "p-4 md:p-5 cursor-pointer transition-all duration-200 touch-manipulation border-2",
              "hover:border-primary/50 hover:shadow-lg",
              selectedMembership === 'none' && "ring-2 ring-primary border-primary shadow-lg bg-primary/5"
            )}
            onClick={() => handleSelect('none')}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-base md:text-lg font-bold">Pay Per Clean</h3>
                  {selectedMembership === 'none' && (
                    <div className="flex-shrink-0 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  )}
                </div>
                <p className="text-xs md:text-sm text-muted-foreground mb-3">No commitment required</p>
                <div className="text-2xl md:text-3xl font-bold mb-3">
                  $0<span className="text-base md:text-lg text-muted-foreground font-normal">/month</span>
                </div>
                <ul className="space-y-1.5">
                  <li className="flex items-start gap-2 text-xs md:text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Pay only for services you book</span>
                  </li>
                  <li className="flex items-start gap-2 text-xs md:text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>No monthly fees or obligations</span>
                  </li>
                  <li className="flex items-start gap-2 text-xs md:text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Cancel anytime, no hassle</span>
                  </li>
                </ul>
              </div>
            </div>
          </Card>

          {/* Membership Plans */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
            {(Object.keys(MEMBERSHIP_PLANS) as Array<keyof typeof MEMBERSHIP_PLANS>)
              .filter(key => key !== 'none')
              .map((planId) => {
                const plan = MEMBERSHIP_PLANS[planId];
                const isRecommended = (planId as string) === 'standard';
                const isSelected = selectedMembership === planId;
                
                return (
                  <Card
                    key={planId}
                    className={cn(
                      "p-4 md:p-5 cursor-pointer transition-all duration-200 touch-manipulation border-2 relative",
                      "hover:border-primary/50 hover:shadow-lg",
                      isSelected && "ring-2 ring-primary border-primary shadow-lg bg-primary/5",
                      isRecommended && !isSelected && "border-primary/30"
                    )}
                    onClick={() => handleSelect(planId)}
                  >
                    {isRecommended && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
                        <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full shadow-md">
                          Popular
                        </span>
                      </div>
                    )}
                    
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-base md:text-lg font-bold leading-tight">{plan.label}</h3>
                        {isSelected && (
                          <div className="flex-shrink-0 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                      
                      <div>
                        <div className="text-2xl md:text-3xl font-bold">
                          ${plan.monthlyPrice}
                        </div>
                        <p className="text-xs text-muted-foreground">/month</p>
                      </div>

                      <div className="space-y-2 pt-2 border-t">
                        <div className="flex items-center gap-2 bg-accent/30 rounded-lg p-2">
                          <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                          <div className="text-xs md:text-sm">
                            <span className="font-semibold">{plan.cleansPerMonth}</span> {plan.cleansPerMonth === 1 ? 'clean' : 'cleans'}/mo
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 bg-accent/30 rounded-lg p-2">
                          <Clock className="w-4 h-4 text-primary flex-shrink-0" />
                          <div className="text-xs md:text-sm">
                            <span className="font-semibold">{plan.includedHours}</span> hrs included
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 bg-accent/30 rounded-lg p-2">
                          <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          <div className="text-xs md:text-sm">
                            <span className="font-semibold">{Math.round(plan.overtimeDiscount * 100)}%</span> off overtime
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Perfect for {(planId as string) === 'essential' ? 'monthly' : (planId as string) === 'standard' ? 'bi-weekly' : 'weekly'} cleaning schedules
                        </p>
                      </div>
                    </div>
                  </Card>
                );
              })}
          </div>
        </div>

        {/* Footer with action buttons */}
        <div className="sticky bottom-0 bg-background border-t p-4 md:p-6 flex gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
