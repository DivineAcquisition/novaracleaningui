import { Link } from "react-router-dom";

export function BookingFooter() {
  return (
    <footer className="mt-auto py-6 px-4 border-t border-border/40 bg-background/60">
      <div className="container max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link 
              to="/privacy-policy" 
              className="hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
            >
              Privacy Policy
            </Link>
            <span className="hidden sm:inline">•</span>
            <Link 
              to="/terms-of-service" 
              className="hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
            >
              Terms of Service
            </Link>
          </div>
          <p className="text-center sm:text-right">
            © 2025 NovaraCleaning. All Rights Reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
