"use client";

import { 
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Clock, Sparkles, Crown, X } from "lucide-react";
import { MEMBERSHIP_PLANS } from "@/lib/pricing-system";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MembershipBottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedMembership: string;
  onSelect: (membershipId: keyof typeof MEMBERSHIP_PLANS) => void;
}

export function MembershipBottomSheet({
  open,
  onOpenChange,
  selectedMembership,
  onSelect,
}: MembershipBottomSheetProps) {

  const handleSelect = (membershipId: keyof typeof MEMBERSHIP_PLANS) => {
    onSelect(membershipId);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="border-b">
          <DrawerTitle className="text-xl font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-primary" />
            Choose Your Plan
          </DrawerTitle>
          <DrawerDescription>
            Save more with monthly plans or pay as you go
          </DrawerDescription>
        </DrawerHeader>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-3">
            {/* Pay Per Clean */}
            <Card
              className={cn(
                "p-4 cursor-pointer transition-all duration-200 touch-manipulation border-2",
                "active:scale-[0.98]",
                selectedMembership === 'none' && "ring-2 ring-primary border-primary shadow-lg bg-primary/5"
              )}
              onClick={() => handleSelect('none')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-base font-bold">Pay Per Clean</h3>
                    {selectedMembership === 'none' && (
                      <div className="flex-shrink-0 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">No commitment required</p>
                  <div className="text-2xl font-bold mb-3">
                    $0<span className="text-base text-muted-foreground font-normal">/month</span>
                  </div>
                  <ul className="space-y-1.5">
                    <li className="flex items-start gap-2 text-xs">
                      <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>Pay only for services you book</span>
                    </li>
                    <li className="flex items-start gap-2 text-xs">
                      <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>No monthly fees or obligations</span>
                    </li>
                    <li className="flex items-start gap-2 text-xs">
                      <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>Cancel anytime, no hassle</span>
                    </li>
                  </ul>
                </div>
              </div>
            </Card>

            {/* Membership Plans */}
            <div className="space-y-3">
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
                        "p-4 cursor-pointer transition-all duration-200 touch-manipulation border-2 relative",
                        "active:scale-[0.98]",
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
                          <h3 className="text-base font-bold leading-tight">{plan.label}</h3>
                          {isSelected && (
                            <div className="flex-shrink-0 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                              <Check className="w-3 h-3 text-primary-foreground" />
                            </div>
                          )}
                        </div>
                        
                        <div>
                          <div className="text-2xl font-bold">
                            ${plan.monthlyPrice}
                          </div>
                          <p className="text-xs text-muted-foreground">/month</p>
                        </div>

                        <div className="space-y-2 pt-2 border-t">
                          <div className="flex items-center gap-2 bg-accent/30 rounded-lg p-2">
                            <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                            <div className="text-xs">
                              <span className="font-semibold">{plan.cleansPerMonth}</span> {plan.cleansPerMonth === 1 ? 'clean' : 'cleans'}/mo
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 bg-accent/30 rounded-lg p-2">
                            <Clock className="w-4 h-4 text-primary flex-shrink-0" />
                            <div className="text-xs">
                              <span className="font-semibold">{plan.includedHours}</span> hrs included
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 bg-accent/30 rounded-lg p-2">
                            <Check className="w-4 h-4 text-primary flex-shrink-0" />
                            <div className="text-xs">
                              <span className="font-semibold">{Math.round(plan.overtimeDiscount * 100)}%</span> off overtime
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
            </div>
          </div>
        </ScrollArea>

        <DrawerFooter className="border-t pt-4">
          <Button
            onClick={() => onOpenChange(false)}
            className="w-full h-12"
          >
            Continue with Selected Plan
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
