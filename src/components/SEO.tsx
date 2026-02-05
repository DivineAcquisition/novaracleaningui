import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  type?: 'website' | 'article';
}

const DEFAULT_TITLE = 'Novara Cleaning';
const DEFAULT_DESCRIPTION = 'Maryland\'s most reliable home cleaning service. Book trusted, vetted cleaners in minutes. Transparent pricing, satisfaction guaranteed.';
const DEFAULT_IMAGE = 'https://storage.googleapis.com/gpt-engineer-file-uploads/gKZdtAV5x1fAVy9ghNl5qNeLg112/social-images/social-1764892555639-Comp 1 (0;00;00;13).png';

// Page-specific SEO configurations
export const PAGE_SEO: Record<string, SEOProps> = {
  '/': {
    title: 'Novara Cleaning | Maryland\'s Most Reliable Home Cleaning Service',
    description: 'Book trusted, vetted home cleaners in 2 minutes. Serving Bethesda, Rockville, Silver Spring & all of Maryland. Transparent pricing. Satisfaction guaranteed.',
    keywords: 'house cleaning maryland, home cleaning service, maid service bethesda, cleaning service rockville, silver spring cleaners',
  },
  '/book/zip': {
    title: 'Book Your Cleaning | Check Service Area | Novara Cleaning',
    description: 'Enter your ZIP code to check if we service your area and get instant pricing for professional home cleaning.',
    keywords: 'book cleaning, cleaning service near me, check zip code, service area',
  },
  '/book/sqft': {
    title: 'Select Home Size | Get Instant Quote | Novara Cleaning',
    description: 'Tell us about your home size and get an instant, transparent quote for professional cleaning services.',
    keywords: 'cleaning quote, home size, cleaning estimate, transparent pricing',
  },
  '/book/offer': {
    title: 'Choose Your Service | One-Time or Membership | Novara Cleaning',
    description: 'Choose between one-time deep cleaning or save up to 40% with our membership plans. Flexible scheduling available.',
    keywords: 'cleaning service, deep clean, recurring cleaning, cleaning membership',
  },
  '/book/checkout': {
    title: 'Secure Checkout | Complete Your Booking | Novara Cleaning',
    description: 'Complete your booking securely. Your cleaning is just moments away from being confirmed.',
    keywords: 'book cleaning, secure checkout, schedule cleaning',
  },
  '/book/details': {
    title: 'Property Details | Complete Your Booking | Novara Cleaning',
    description: 'Enter your property details to complete your cleaning booking.',
    keywords: 'property details, address, booking details',
  },
  '/book/confirmation': {
    title: 'Booking Confirmed! | Novara Cleaning',
    description: 'Your cleaning has been confirmed. Add it to your calendar and share your referral code to earn credits.',
    keywords: 'booking confirmed, cleaning scheduled, referral code',
  },
  '/account': {
    title: 'My Account | Dashboard | Novara Cleaning',
    description: 'Manage your bookings, membership, payment methods, and account settings. View booking history and schedule new cleanings.',
    keywords: 'account, dashboard, manage booking, payment methods, membership',
  },
  '/auth': {
    title: 'Sign In | Create Account | Novara Cleaning',
    description: 'Sign in to your Novara Cleaning account or create a new one to manage your bookings and membership.',
    keywords: 'sign in, login, create account, register',
  },
  '/membership': {
    title: 'Membership Plans | Save Up to 40% | Novara Cleaning',
    description: 'Join a Novara membership and save up to 40% on every cleaning. Same trusted team, priority scheduling, cancel anytime.',
    keywords: 'cleaning membership, save money, recurring cleaning, cleaning subscription',
  },
  '/cleaner': {
    title: 'Become a Cleaner | Join Our Team | Novara Cleaning',
    description: 'Join Maryland\'s fastest-growing cleaning team. Flexible hours, competitive pay, and growth opportunities.',
    keywords: 'cleaning jobs, become a cleaner, house cleaning jobs, maryland cleaning jobs',
  },
  '/cleaner/dashboard': {
    title: 'Cleaner Dashboard | Novara Cleaning',
    description: 'Manage your schedule, view job offers, and track your earnings as a Novara cleaning professional.',
    keywords: 'cleaner dashboard, job offers, cleaning schedule',
  },
  '/cleaner/assessment': {
    title: 'Professional Assessment | Novara Cleaning',
    description: 'Complete the professional cleaning assessment to unlock premium job opportunities.',
    keywords: 'cleaning assessment, professional certification',
  },
};

export function SEO({ title, description, keywords, image, type = 'website' }: SEOProps) {
  const location = useLocation();
  
  // Get page-specific SEO or use defaults
  const pageSEO = PAGE_SEO[location.pathname] || {};
  
  const finalTitle = title || pageSEO.title || DEFAULT_TITLE;
  const finalDescription = description || pageSEO.description || DEFAULT_DESCRIPTION;
  const finalImage = image || DEFAULT_IMAGE;
  const finalKeywords = keywords || pageSEO.keywords || '';

  useEffect(() => {
    // Update document title
    document.title = finalTitle;

    // Update meta tags
    const updateMeta = (name: string, content: string, property?: boolean) => {
      const attr = property ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement;
      
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attr, name);
        document.head.appendChild(meta);
      }
      
      meta.content = content;
    };

    // Standard meta tags
    updateMeta('description', finalDescription);
    if (finalKeywords) {
      updateMeta('keywords', finalKeywords);
    }

    // Open Graph tags
    updateMeta('og:title', finalTitle, true);
    updateMeta('og:description', finalDescription, true);
    updateMeta('og:image', finalImage, true);
    updateMeta('og:type', type, true);
    updateMeta('og:url', window.location.href, true);

    // Twitter tags
    updateMeta('twitter:title', finalTitle);
    updateMeta('twitter:description', finalDescription);
    updateMeta('twitter:image', finalImage);
    updateMeta('twitter:card', 'summary_large_image');

    // Canonical URL
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = window.location.href;

  }, [finalTitle, finalDescription, finalImage, finalKeywords, type, location.pathname]);

  return null;
}

export default SEO;
