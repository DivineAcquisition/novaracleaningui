"use client";

export function BookingFooter() {
  return (
    <footer className="mt-auto py-6 px-4 border-t border-border/40 bg-background/60">
      <div className="container max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a 
              href="https://novaracleaning.com/privacy" 
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
            >
              Privacy Policy
            </a>
            <span className="hidden sm:inline">•</span>
            <a 
              href="https://novaracleaning.com/terms" 
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
            >
              Terms of Service
            </a>
          </div>
          <p className="text-center sm:text-right">
            © {new Date().getFullYear()} NovaraCleaning. All Rights Reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
