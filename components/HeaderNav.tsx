"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useMembershipCredits } from "@/hooks/use-membership-credits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, LogOut, Ticket } from "lucide-react";

interface HeaderNavProps {
  onSignOut?: () => void;
}

export function HeaderNav({ onSignOut }: HeaderNavProps) {
  const { user } = useAuth();
  const { credits, hasCredits } = useMembershipCredits();

  return (
    <header className="container mx-auto px-4 py-4 md:py-6">
      <div className="flex justify-between items-center gap-2">
        <Link href="/" className="flex items-center gap-2 md:gap-3 min-w-0">
          <Image src="/logo.png" alt="NovaraCleaning Logo" width={40} height={40} className="w-8 h-8 md:w-10 md:h-10 rounded-lg flex-shrink-0" />
          <span className="text-base md:text-lg font-semibold truncate">NovaraCleaning</span>
        </Link>
        
        {user ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasCredits && credits && (
              <Link href="/membership">
                <Badge className="bg-gradient-primary text-white border-0 h-9 md:h-10 px-3 gap-1.5 hover:opacity-90 transition-opacity cursor-pointer">
                  <Ticket className="w-4 h-4" />
                  <span className="font-semibold">{credits.credits_remaining} {credits.credits_remaining === 1 ? 'Credit' : 'Credits'}</span>
                </Badge>
              </Link>
            )}
            <Link href="/account">
              <Button variant="outline" size="sm" className="h-9 md:h-10">
                <User className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">Account</span>
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={onSignOut} className="h-9 md:h-10" aria-label="Sign out">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <Link href="/auth">
            <Button variant="outline" size="sm" className="h-9 md:h-10 flex-shrink-0">
              Sign In
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
