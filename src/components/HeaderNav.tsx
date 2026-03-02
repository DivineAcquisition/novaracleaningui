import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMembershipCredits } from "@/hooks/use-membership-credits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, LogOut, Ticket } from "lucide-react";
import logo from "@/assets/logo.png";

interface HeaderNavProps {
  onSignOut?: () => void;
}

export function HeaderNav({ onSignOut }: HeaderNavProps) {
  const { user } = useAuth();
  const { credits, hasCredits } = useMembershipCredits();

  return (
    <header className="border-b border-border/40 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="container mx-auto px-4 h-14 md:h-16 flex justify-between items-center">
        <Link to="/" className="flex items-center gap-2.5 min-w-0 group">
          <img src={logo} alt="NovaraCleaning Logo" className="w-8 h-8 md:w-9 md:h-9 rounded-xl flex-shrink-0 shadow-sm transition-transform group-hover:scale-105" />
          <span className="text-base md:text-lg font-bold tracking-tight truncate">NovaraCleaning</span>
        </Link>
        
        {user ? (
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            {hasCredits && credits && (
              <Link to="/portal/book">
                <Badge className="bg-gradient-primary text-white border-0 h-8 md:h-9 px-2.5 md:px-3 gap-1 hover:opacity-90 transition-opacity cursor-pointer shadow-sm rounded-lg">
                  <Ticket className="w-3.5 h-3.5" />
                  <span className="font-semibold text-xs md:text-sm">{credits.credits_remaining}</span>
                  <span className="hidden sm:inline text-xs font-medium opacity-90">
                    {credits.credits_remaining === 1 ? 'Credit' : 'Credits'}
                  </span>
                </Badge>
              </Link>
            )}
            <Link to="/account">
              <Button variant="outline" size="sm" className="h-8 md:h-9 rounded-lg border-border/60">
                <User className="w-4 h-4 md:mr-1.5" />
                <span className="hidden md:inline text-xs">Account</span>
              </Button>
            </Link>
            <Button variant="ghost" size="icon" onClick={onSignOut} className="h-8 w-8 md:h-9 md:w-9 text-muted-foreground hover:text-destructive rounded-lg" aria-label="Sign out">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <Link to="/auth">
            <Button size="sm" className="h-8 md:h-9 rounded-lg bg-gradient-primary shadow-sm px-4">
              Sign In
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
