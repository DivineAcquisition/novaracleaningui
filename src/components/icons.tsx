"use client";

// Site-wide icons.
//
// Every file imports icons from here instead of @remixicon/react. Each export
// keeps its old Remix name so JSX is unchanged, and renders the Lucide icon
// chosen for what it means here, at one stroke weight. Brand logos (which
// Lucide does not draw) stay on Remix. To change an icon everywhere, change it here.

import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  Activity,
  Aperture,
  ArrowDown,
  ArrowDownRight,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Baby,
  Ban,
  BedDouble,
  Bell,
  BookOpen,
  Box,
  Briefcase,
  Building,
  Building2,
  Calculator,
  Calendar,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Camera,
  Captions,
  Car,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CircleDot,
  CircleHelp,
  CirclePause,
  CirclePlay,
  CircleStop,
  CircleX,
  Clipboard,
  ClipboardList,
  Clock,
  CloudOff,
  CloudUpload,
  Copy,
  CreditCard,
  Crown,
  Download,
  Droplet,
  Ellipsis,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FileChartColumn,
  FileDown,
  FilePen,
  FileText,
  FileWarning,
  Filter,
  Flag,
  FolderCheck,
  Gauge,
  Gift,
  GitMerge,
  GraduationCap,
  GripVertical,
  Hammer,
  HandCoins,
  HandHeart,
  Heart,
  HeartHandshake,
  History,
  Hourglass,
  House,
  IdCard,
  Image,
  ImagePlus,
  Info,
  Key,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  Lightbulb,
  Link,
  ListChecks,
  LoaderCircle,
  Lock,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  Map,
  MapPin,
  Megaphone,
  Menu,
  MessageSquare,
  MessageSquareOff,
  Minus,
  Monitor,
  Moon,
  Navigation,
  Paintbrush,
  PanelLeft,
  Pause,
  PenLine,
  Pencil,
  Percent,
  Phone,
  Play,
  Plug,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat,
  Rocket,
  Ruler,
  Save,
  Scale,
  ScanSearch,
  Scissors,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  ShieldEllipsis,
  ShieldUser,
  ShieldX,
  Shirt,
  ShoppingBasket,
  Siren,
  SkipForward,
  Smartphone,
  Smile,
  Sparkles,
  Star,
  StickyNote,
  Sun,
  Sunrise,
  Table,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Ticket,
  TicketPercent,
  Timer,
  Trash2,
  TriangleAlert,
  Trophy,
  Undo2,
  Upload,
  User,
  UserCheck,
  UserMinus,
  UserPlus,
  UserRoundCheck,
  UserRoundPlus,
  UserSearch,
  Users,
  UsersRound,
  Video,
  Volume2,
  VolumeX,
  Wallet,
  WifiOff,
  Wrench,
  X,
  Zap,
} from "lucide-react";

export { RiDiscordFill, RiFacebookFill, RiGoogleFill, RiInstagramLine } from "@remixicon/react";

export type AppIcon = LucideIcon;
/** Kept for files that typed icons as Remix components. */
export type RemixiconComponentType = LucideIcon;

function icon(Base: LucideIcon, filled = false): LucideIcon {
  const Wrapped = forwardRef<SVGSVGElement, LucideProps>(function AppIcon(props, ref) {
    // Only set fill on filled icons: passing fill={undefined} would override
    // Lucide's fill="none" and paint outline icons solid.
    const fillProps = filled ? { fill: "currentColor" } : {};
    return <Base ref={ref} strokeWidth={1.75} aria-hidden={props["aria-label"] ? undefined : true} {...fillProps} {...props} />;
  });
  Wrapped.displayName = Base.displayName;
  return Wrapped as unknown as LucideIcon;
}

export const RiAddLine = icon(Plus);
export const RiAlarmWarningLine = icon(Siren);
export const RiAlertLine = icon(TriangleAlert);
export const RiArrowDownLine = icon(ArrowDown);
export const RiArrowDownSLine = icon(ChevronDown);
export const RiArrowGoBackLine = icon(Undo2);
export const RiArrowLeftLine = icon(ArrowLeft);
export const RiArrowLeftRightLine = icon(ArrowLeftRight);
export const RiArrowLeftSLine = icon(ChevronLeft);
export const RiArrowRightDownLine = icon(ArrowDownRight);
export const RiArrowRightLine = icon(ArrowRight);
export const RiArrowRightSLine = icon(ChevronRight);
export const RiArrowRightUpLine = icon(ArrowUpRight);
export const RiArrowUpLine = icon(ArrowUp);
export const RiArrowUpSLine = icon(ChevronUp);
export const RiBankCard2Line = icon(CreditCard);
export const RiBankCardLine = icon(CreditCard);
export const RiBearSmileLine = icon(Baby);
export const RiBookOpenLine = icon(BookOpen);
export const RiBox3Line = icon(Box);
export const RiBriefcaseLine = icon(Briefcase);
export const RiBrushLine = icon(Paintbrush);
export const RiBuilding2Line = icon(Building2);
export const RiBuilding4Line = icon(Building);
export const RiCalculatorLine = icon(Calculator);
export const RiCalendarCheckLine = icon(CalendarCheck2);
export const RiCalendarEventLine = icon(CalendarDays);
export const RiCalendarLine = icon(Calendar);
export const RiCalendarScheduleLine = icon(CalendarClock);
export const RiCameraLensLine = icon(Aperture);
export const RiCameraLine = icon(Camera);
export const RiCarLine = icon(Car);
export const RiChat3Line = icon(MessageSquare);
export const RiChatOffLine = icon(MessageSquareOff);
export const RiCheckLine = icon(Check);
export const RiCheckboxCircleFill = icon(CircleCheck);
export const RiCheckboxCircleLine = icon(CircleCheck);
export const RiCircleLine = icon(Circle);
export const RiClipboardLine = icon(Clipboard);
export const RiCloseCircleLine = icon(CircleX);
export const RiCloseLine = icon(X);
export const RiClosedCaptioningLine = icon(Captions);
export const RiCloudOffLine = icon(CloudOff);
export const RiComputerLine = icon(Monitor);
export const RiCoupon3Line = icon(TicketPercent);
export const RiDashboard3Line = icon(Gauge);
export const RiDashboardLine = icon(LayoutGrid);
export const RiDeleteBin6Line = icon(Trash2);
export const RiDeleteBinLine = icon(Trash2);
export const RiDownload2Line = icon(Download);
export const RiDownloadLine = icon(Download);
export const RiDraggable = icon(GripVertical);
export const RiDropLine = icon(Droplet);
export const RiEdit2Line = icon(Pencil);
export const RiEditLine = icon(Pencil);
export const RiEraserLine = icon(Eraser);
export const RiErrorWarningLine = icon(CircleAlert);
export const RiExternalLinkLine = icon(ExternalLink);
export const RiEyeLine = icon(Eye);
export const RiEyeOffLine = icon(EyeOff);
export const RiFileChartLine = icon(FileChartColumn);
export const RiFileCopyLine = icon(Copy);
export const RiFileDownloadLine = icon(FileDown);
export const RiFileEditLine = icon(FilePen);
export const RiFileList3Line = icon(ClipboardList);
export const RiFilePdf2Line = icon(FileText);
export const RiFilePdfLine = icon(FileText);
export const RiFileTextLine = icon(FileText);
export const RiFileWarningLine = icon(FileWarning);
export const RiFilterLine = icon(Filter);
export const RiFlagLine = icon(Flag);
export const RiFlashlightFill = icon(Zap);
export const RiFlashlightLine = icon(Zap);
export const RiFolderCheckLine = icon(FolderCheck);
export const RiGift2Line = icon(Gift);
export const RiGiftLine = icon(Gift);
export const RiGitMergeLine = icon(GitMerge);
export const RiGraduationCapLine = icon(GraduationCap);
export const RiGroup2Line = icon(UsersRound);
export const RiGroupLine = icon(Users);
export const RiHammerLine = icon(Hammer);
export const RiHandCoinLine = icon(HandCoins);
export const RiHandHeartLine = icon(HandHeart);
export const RiHeart3Fill = icon(Heart, true);
export const RiHeartsLine = icon(Heart);
export const RiHistoryLine = icon(History);
export const RiHome3Line = icon(House);
export const RiHome4Line = icon(House);
export const RiHomeLine = icon(House);
export const RiHomeSmile2Line = icon(House);
export const RiHomeSmileLine = icon(House);
export const RiHotelBedLine = icon(BedDouble);
export const RiHotelLine = icon(Building);
export const RiHourglassLine = icon(Hourglass);
export const RiIdCardLine = icon(IdCard);
export const RiImage2Line = icon(Image);
export const RiImageAddLine = icon(ImagePlus);
export const RiImageLine = icon(Image);
export const RiInformationLine = icon(Info);
export const RiKey2Line = icon(KeyRound);
export const RiKeyLine = icon(Key);
export const RiLifebuoyLine = icon(LifeBuoy);
export const RiLightbulbLine = icon(Lightbulb);
export const RiLineChartLine = icon(ChartLine);
export const RiLink = icon(Link);
export const RiLinkM = icon(Link);
export const RiListCheck2 = icon(ListChecks);
export const RiLoader4Line = icon(LoaderCircle);
export const RiLock2Line = icon(LockKeyhole);
export const RiLockLine = icon(Lock);
export const RiLoginBoxLine = icon(LogIn);
export const RiLoginCircleLine = icon(LogIn);
export const RiLogoutBoxRLine = icon(LogOut);
export const RiLogoutCircleRLine = icon(LogOut);
export const RiMailLine = icon(Mail);
export const RiMailSendLine = icon(Send);
export const RiMapPin2Line = icon(MapPin);
export const RiMapPinLine = icon(MapPin);
export const RiMegaphoneLine = icon(Megaphone);
export const RiMenuLine = icon(Menu);
export const RiMoneyDollarCircleLine = icon(CircleDollarSign);
export const RiMoonLine = icon(Moon);
export const RiMoreLine = icon(Ellipsis);
export const RiNavigationLine = icon(Navigation);
export const RiNotification3Line = icon(Bell);
export const RiPauseCircleLine = icon(CirclePause);
export const RiPauseFill = icon(Pause, true);
export const RiPauseLine = icon(Pause);
export const RiPercentLine = icon(Percent);
export const RiPhoneFill = icon(Phone);
export const RiPhoneLine = icon(Phone);
export const RiPlayCircleLine = icon(CirclePlay);
export const RiPlayFill = icon(Play, true);
export const RiPlayLine = icon(Play);
export const RiPlugLine = icon(Plug);
export const RiPriceTag3Line = icon(Tag);
export const RiProhibitedLine = icon(Ban);
export const RiPulseLine = icon(Activity);
export const RiQuestionLine = icon(CircleHelp);
export const RiQuillPenLine = icon(PenLine);
export const RiRadioButtonLine = icon(CircleDot);
export const RiRefreshLine = icon(RefreshCw);
export const RiRefund2Line = icon(ReceiptText);
export const RiRepeatLine = icon(Repeat);
export const RiRoadMapLine = icon(Map);
export const RiRocket2Line = icon(Rocket);
export const RiRulerLine = icon(Ruler);
export const RiSaveLine = icon(Save);
export const RiScales3Line = icon(Scale);
export const RiScissorsCutLine = icon(Scissors);
export const RiSearch2Line = icon(Search);
export const RiSearchEyeLine = icon(ScanSearch);
export const RiSearchLine = icon(Search);
export const RiSecurePaymentLine = icon(ShieldCheck);
export const RiSendPlane2Line = icon(Send);
export const RiSendPlaneFill = icon(Send);
export const RiSendPlaneLine = icon(Send);
export const RiSettings3Line = icon(Settings);
export const RiShareLine = icon(Share2);
export const RiShieldCheckLine = icon(ShieldCheck);
export const RiShieldCrossLine = icon(ShieldX);
export const RiShieldKeyholeLine = icon(ShieldEllipsis);
export const RiShieldLine = icon(Shield);
export const RiShieldStarLine = icon(ShieldCheck);
export const RiShieldUserLine = icon(ShieldUser);
export const RiShirtLine = icon(Shirt);
export const RiShoppingBasket2Line = icon(ShoppingBasket);
export const RiSideBarLine = icon(PanelLeft);
export const RiSkipForwardLine = icon(SkipForward);
export const RiSmartphoneLine = icon(Smartphone);
export const RiSparkling2Fill = icon(Sparkles);
export const RiSparkling2Line = icon(Sparkles);
export const RiSparklingLine = icon(Sparkles);
export const RiSpeedUpLine = icon(Gauge);
export const RiStarFill = icon(Star, true);
export const RiStarLine = icon(Star);
export const RiStarSmileLine = icon(Star);
export const RiStickyNoteLine = icon(StickyNote);
export const RiStopCircleLine = icon(CircleStop);
export const RiSubtractLine = icon(Minus);
export const RiSunFoggyLine = icon(Sunrise);
export const RiSunLine = icon(Sun);
export const RiTShirtLine = icon(Shirt);
export const RiTableLine = icon(Table);
export const RiTeamLine = icon(Users);
export const RiThumbDownLine = icon(ThumbsDown);
export const RiThumbUpLine = icon(ThumbsUp);
export const RiTicket2Line = icon(Ticket);
export const RiTicketLine = icon(Ticket);
export const RiTimeLine = icon(Clock);
export const RiTimerFlashLine = icon(Timer);
export const RiToolsLine = icon(Wrench);
export const RiTrophyLine = icon(Trophy);
export const RiUpload2Line = icon(Upload);
export const RiUploadCloud2Line = icon(CloudUpload);
export const RiUploadLine = icon(Upload);
export const RiUser3Line = icon(User);
export const RiUserAddLine = icon(UserPlus);
export const RiUserFollowLine = icon(UserCheck);
export const RiUserHeartLine = icon(HeartHandshake);
export const RiUserLine = icon(User);
export const RiUserSearchLine = icon(UserSearch);
export const RiUserSharedLine = icon(UserRoundPlus);
export const RiUserSmileLine = icon(Smile);
export const RiUserStarLine = icon(UserRoundCheck);
export const RiUserUnfollowLine = icon(UserMinus);
export const RiVideoLine = icon(Video);
export const RiVipCrown2Line = icon(Crown);
export const RiVipCrownLine = icon(Crown);
export const RiVolumeMuteLine = icon(VolumeX);
export const RiVolumeUpLine = icon(Volume2);
export const RiWallet3Line = icon(Wallet);
export const RiWalletLine = icon(Wallet);
export const RiWifiOffLine = icon(WifiOff);
export const RiZzzLine = icon(Moon);
