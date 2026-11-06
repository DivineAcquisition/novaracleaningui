"use client";

// Site-wide icons.
//
// Every file imports icons from here. Each export keeps its old Remix name so
// JSX is unchanged, and renders the Phosphor icon chosen for what it means
// here: duotone for objects and ideas, regular for arrows and controls, solid
// for "Fill" names. Brand logos stay on Remix. To change an icon everywhere,
// change it here.

import { forwardRef, type ForwardRefExoticComponent, type RefAttributes } from "react";
import type { IconProps, IconWeight, Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  Aperture,
  ArrowDown,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowUUpLeft,
  ArrowUp,
  ArrowUpRight,
  ArrowsClockwise,
  ArrowsLeftRight,
  Baby,
  Basket,
  Bed,
  Bell,
  BookOpen,
  Briefcase,
  Building,
  Buildings,
  Calculator,
  Calendar,
  CalendarBlank,
  CalendarCheck,
  CalendarDots,
  Camera,
  Car,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  ChartBar,
  ChartLine,
  ChatCircleSlash,
  ChatCircleText,
  Check,
  CheckCircle,
  Circle,
  CircleNotch,
  Clipboard,
  ClipboardText,
  Clock,
  ClockCounterClockwise,
  ClosedCaptioning,
  CloudArrowUp,
  CloudSlash,
  Copy,
  CreditCard,
  Crown,
  CurrencyCircleDollar,
  DeviceMobile,
  DotsSixVertical,
  DotsThree,
  DownloadSimple,
  Drop,
  Envelope,
  Eraser,
  Eye,
  EyeSlash,
  FileArrowDown,
  FileText,
  Flag,
  FloppyDisk,
  FolderSimpleStar,
  Funnel,
  Gauge,
  GearSix,
  Gift,
  GitMerge,
  GraduationCap,
  Hammer,
  HandCoins,
  HandHeart,
  Handshake,
  Heart,
  Hourglass,
  House,
  IdentificationCard,
  Image,
  ImageSquare,
  Info,
  Key,
  Lifebuoy,
  Lightbulb,
  Lightning,
  Link,
  List,
  ListChecks,
  Lock,
  LockKey,
  MagnifyingGlass,
  MagnifyingGlassPlus,
  MapPin,
  MapTrifold,
  Megaphone,
  Minus,
  Monitor,
  Moon,
  NavigationArrow,
  Note,
  NotePencil,
  Package,
  PaintBrush,
  PaperPlaneTilt,
  Pause,
  PauseCircle,
  PencilLine,
  PencilSimple,
  Percent,
  Phone,
  Play,
  PlayCircle,
  Plug,
  Plus,
  Prohibit,
  Pulse,
  Question,
  RadioButton,
  Receipt,
  Repeat,
  RocketLaunch,
  Ruler,
  Scales,
  Scissors,
  ShareNetwork,
  Shield,
  ShieldCheck,
  ShieldSlash,
  ShieldStar,
  SidebarSimple,
  SignIn,
  SignOut,
  Siren,
  SkipForward,
  Smiley,
  Sparkle,
  SpeakerHigh,
  SpeakerSlash,
  SquaresFour,
  Star,
  StopCircle,
  Sun,
  SunHorizon,
  TShirt,
  Table,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Ticket,
  Timer,
  Trash,
  Trophy,
  UploadSimple,
  User,
  UserCheck,
  UserCircleCheck,
  UserFocus,
  UserMinus,
  UserPlus,
  Users,
  UsersThree,
  VideoCamera,
  Wallet,
  Warning,
  WarningCircle,
  WifiSlash,
  Wrench,
  X,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";

export type AppIcon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;
export type RemixiconComponentType = AppIcon;

function icon(Base: PhosphorIcon, weight: IconWeight): AppIcon {
  const Wrapped = forwardRef<SVGSVGElement, IconProps>(function AppIcon(props, ref) {
    return <Base ref={ref} size={24} weight={weight} aria-hidden={props["aria-label"] ? undefined : true} {...props} />;
  });
  Wrapped.displayName = Base.displayName;
  return Wrapped;
}

export const RiAddLine = icon(Plus, "regular");
export const RiAlarmWarningLine = icon(Siren, "duotone");
export const RiAlertLine = icon(Warning, "duotone");
export const RiArrowDownLine = icon(ArrowDown, "regular");
export const RiArrowDownSLine = icon(CaretDown, "regular");
export const RiArrowGoBackLine = icon(ArrowUUpLeft, "regular");
export const RiArrowLeftLine = icon(ArrowLeft, "regular");
export const RiArrowLeftRightLine = icon(ArrowsLeftRight, "regular");
export const RiArrowLeftSLine = icon(CaretLeft, "regular");
export const RiArrowRightDownLine = icon(ArrowDownRight, "regular");
export const RiArrowRightLine = icon(ArrowRight, "regular");
export const RiArrowRightSLine = icon(CaretRight, "regular");
export const RiArrowRightUpLine = icon(ArrowUpRight, "regular");
export const RiArrowUpLine = icon(ArrowUp, "regular");
export const RiArrowUpSLine = icon(CaretUp, "regular");
export const RiBankCard2Line = icon(CreditCard, "duotone");
export const RiBankCardLine = icon(CreditCard, "duotone");
export const RiBearSmileLine = icon(Baby, "duotone");
export const RiBookOpenLine = icon(BookOpen, "duotone");
export const RiBox3Line = icon(Package, "duotone");
export const RiBriefcaseLine = icon(Briefcase, "duotone");
export const RiBrushLine = icon(PaintBrush, "duotone");
export const RiBuilding2Line = icon(Buildings, "duotone");
export const RiBuilding4Line = icon(Building, "duotone");
export const RiCalculatorLine = icon(Calculator, "duotone");
export const RiCalendarCheckLine = icon(CalendarCheck, "duotone");
export const RiCalendarEventLine = icon(CalendarBlank, "duotone");
export const RiCalendarLine = icon(Calendar, "duotone");
export const RiCalendarScheduleLine = icon(CalendarDots, "duotone");
export const RiCameraLensLine = icon(Aperture, "duotone");
export const RiCameraLine = icon(Camera, "duotone");
export const RiCarLine = icon(Car, "duotone");
export const RiChat3Line = icon(ChatCircleText, "duotone");
export const RiChatOffLine = icon(ChatCircleSlash, "duotone");
export const RiCheckLine = icon(Check, "regular");
export const RiCheckboxCircleFill = icon(CheckCircle, "fill");
export const RiCheckboxCircleLine = icon(CheckCircle, "duotone");
export const RiCircleLine = icon(Circle, "regular");
export const RiClipboardLine = icon(Clipboard, "duotone");
export const RiCloseCircleLine = icon(XCircle, "duotone");
export const RiCloseLine = icon(X, "regular");
export const RiClosedCaptioningLine = icon(ClosedCaptioning, "duotone");
export const RiCloudOffLine = icon(CloudSlash, "duotone");
export const RiComputerLine = icon(Monitor, "duotone");
export const RiCoupon3Line = icon(Tag, "duotone");
export const RiDashboard3Line = icon(Gauge, "duotone");
export const RiDashboardLine = icon(SquaresFour, "duotone");
export const RiDeleteBin6Line = icon(Trash, "duotone");
export const RiDeleteBinLine = icon(Trash, "duotone");
export const RiDownload2Line = icon(DownloadSimple, "duotone");
export const RiDownloadLine = icon(DownloadSimple, "duotone");
export const RiDraggable = icon(DotsSixVertical, "regular");
export const RiDropLine = icon(Drop, "duotone");
export const RiEdit2Line = icon(PencilSimple, "duotone");
export const RiEditLine = icon(PencilSimple, "duotone");
export const RiEraserLine = icon(Eraser, "duotone");
export const RiErrorWarningLine = icon(WarningCircle, "duotone");
export const RiExternalLinkLine = icon(ArrowSquareOut, "regular");
export const RiEyeLine = icon(Eye, "duotone");
export const RiEyeOffLine = icon(EyeSlash, "duotone");
export const RiFileChartLine = icon(ChartBar, "duotone");
export const RiFileCopyLine = icon(Copy, "regular");
export const RiFileDownloadLine = icon(FileArrowDown, "duotone");
export const RiFileEditLine = icon(NotePencil, "duotone");
export const RiFileList3Line = icon(ClipboardText, "duotone");
export const RiFilePdf2Line = icon(FileText, "duotone");
export const RiFilePdfLine = icon(FileText, "duotone");
export const RiFileTextLine = icon(FileText, "duotone");
export const RiFileWarningLine = icon(Warning, "duotone");
export const RiFilterLine = icon(Funnel, "regular");
export const RiFlagLine = icon(Flag, "duotone");
export const RiFlashlightFill = icon(Lightning, "fill");
export const RiFlashlightLine = icon(Lightning, "duotone");
export const RiFolderCheckLine = icon(FolderSimpleStar, "duotone");
export const RiGift2Line = icon(Gift, "duotone");
export const RiGiftLine = icon(Gift, "duotone");
export const RiGitMergeLine = icon(GitMerge, "duotone");
export const RiGraduationCapLine = icon(GraduationCap, "duotone");
export const RiGroup2Line = icon(UsersThree, "duotone");
export const RiGroupLine = icon(Users, "duotone");
export const RiHammerLine = icon(Hammer, "duotone");
export const RiHandCoinLine = icon(HandCoins, "duotone");
export const RiHandHeartLine = icon(HandHeart, "duotone");
export const RiHeart3Fill = icon(Heart, "fill");
export const RiHeartsLine = icon(Heart, "duotone");
export const RiHistoryLine = icon(ClockCounterClockwise, "duotone");
export const RiHome3Line = icon(House, "duotone");
export const RiHome4Line = icon(House, "duotone");
export const RiHomeLine = icon(House, "duotone");
export const RiHomeSmile2Line = icon(House, "duotone");
export const RiHomeSmileLine = icon(House, "duotone");
export const RiHotelBedLine = icon(Bed, "duotone");
export const RiHotelLine = icon(Building, "duotone");
export const RiHourglassLine = icon(Hourglass, "duotone");
export const RiIdCardLine = icon(IdentificationCard, "duotone");
export const RiImage2Line = icon(Image, "duotone");
export const RiImageAddLine = icon(ImageSquare, "duotone");
export const RiImageLine = icon(Image, "duotone");
export const RiInformationLine = icon(Info, "duotone");
export const RiKey2Line = icon(Key, "duotone");
export const RiKeyLine = icon(Key, "duotone");
export const RiLifebuoyLine = icon(Lifebuoy, "duotone");
export const RiLightbulbLine = icon(Lightbulb, "duotone");
export const RiLineChartLine = icon(ChartLine, "duotone");
export const RiLink = icon(Link, "duotone");
export const RiLinkM = icon(Link, "duotone");
export const RiListCheck2 = icon(ListChecks, "duotone");
export const RiLoader4Line = icon(CircleNotch, "regular");
export const RiLock2Line = icon(LockKey, "duotone");
export const RiLockLine = icon(Lock, "duotone");
export const RiLoginBoxLine = icon(SignIn, "duotone");
export const RiLoginCircleLine = icon(SignIn, "duotone");
export const RiLogoutBoxRLine = icon(SignOut, "duotone");
export const RiLogoutCircleRLine = icon(SignOut, "duotone");
export const RiMailLine = icon(Envelope, "duotone");
export const RiMailSendLine = icon(PaperPlaneTilt, "duotone");
export const RiMapPin2Line = icon(MapPin, "duotone");
export const RiMapPinLine = icon(MapPin, "duotone");
export const RiMegaphoneLine = icon(Megaphone, "duotone");
export const RiMenuLine = icon(List, "regular");
export const RiMoneyDollarCircleLine = icon(CurrencyCircleDollar, "duotone");
export const RiMoonLine = icon(Moon, "duotone");
export const RiMoreLine = icon(DotsThree, "regular");
export const RiNavigationLine = icon(NavigationArrow, "duotone");
export const RiNotification3Line = icon(Bell, "duotone");
export const RiPauseCircleLine = icon(PauseCircle, "duotone");
export const RiPauseFill = icon(Pause, "fill");
export const RiPauseLine = icon(Pause, "duotone");
export const RiPercentLine = icon(Percent, "duotone");
export const RiPhoneFill = icon(Phone, "fill");
export const RiPhoneLine = icon(Phone, "duotone");
export const RiPlayCircleLine = icon(PlayCircle, "duotone");
export const RiPlayFill = icon(Play, "fill");
export const RiPlayLine = icon(Play, "duotone");
export const RiPlugLine = icon(Plug, "duotone");
export const RiPriceTag3Line = icon(Tag, "duotone");
export const RiProhibitedLine = icon(Prohibit, "duotone");
export const RiPulseLine = icon(Pulse, "duotone");
export const RiQuestionLine = icon(Question, "duotone");
export const RiQuillPenLine = icon(PencilLine, "duotone");
export const RiRadioButtonLine = icon(RadioButton, "duotone");
export const RiRefreshLine = icon(ArrowsClockwise, "duotone");
export const RiRefund2Line = icon(Receipt, "duotone");
export const RiRepeatLine = icon(Repeat, "duotone");
export const RiRoadMapLine = icon(MapTrifold, "duotone");
export const RiRocket2Line = icon(RocketLaunch, "duotone");
export const RiRulerLine = icon(Ruler, "duotone");
export const RiSaveLine = icon(FloppyDisk, "duotone");
export const RiScales3Line = icon(Scales, "duotone");
export const RiScissorsCutLine = icon(Scissors, "duotone");
export const RiSearch2Line = icon(MagnifyingGlass, "regular");
export const RiSearchEyeLine = icon(MagnifyingGlassPlus, "duotone");
export const RiSearchLine = icon(MagnifyingGlass, "regular");
export const RiSecurePaymentLine = icon(ShieldCheck, "duotone");
export const RiSendPlane2Line = icon(PaperPlaneTilt, "duotone");
export const RiSendPlaneFill = icon(PaperPlaneTilt, "fill");
export const RiSendPlaneLine = icon(PaperPlaneTilt, "duotone");
export const RiSettings3Line = icon(GearSix, "duotone");
export const RiShareLine = icon(ShareNetwork, "duotone");
export const RiShieldCheckLine = icon(ShieldCheck, "duotone");
export const RiShieldCrossLine = icon(ShieldSlash, "duotone");
export const RiShieldKeyholeLine = icon(ShieldStar, "duotone");
export const RiShieldLine = icon(Shield, "duotone");
export const RiShieldStarLine = icon(ShieldCheck, "duotone");
export const RiShieldUserLine = icon(UserCircleCheck, "duotone");
export const RiShirtLine = icon(TShirt, "duotone");
export const RiShoppingBasket2Line = icon(Basket, "duotone");
export const RiSideBarLine = icon(SidebarSimple, "duotone");
export const RiSkipForwardLine = icon(SkipForward, "duotone");
export const RiSmartphoneLine = icon(DeviceMobile, "duotone");
export const RiSparkling2Fill = icon(Sparkle, "fill");
export const RiSparkling2Line = icon(Sparkle, "duotone");
export const RiSparklingLine = icon(Sparkle, "duotone");
export const RiSpeedUpLine = icon(Gauge, "duotone");
export const RiStarFill = icon(Star, "fill");
export const RiStarLine = icon(Star, "duotone");
export const RiStarSmileLine = icon(Star, "duotone");
export const RiStickyNoteLine = icon(Note, "duotone");
export const RiStopCircleLine = icon(StopCircle, "duotone");
export const RiSubtractLine = icon(Minus, "regular");
export const RiSunFoggyLine = icon(SunHorizon, "duotone");
export const RiSunLine = icon(Sun, "duotone");
export const RiTShirtLine = icon(TShirt, "duotone");
export const RiTableLine = icon(Table, "duotone");
export const RiTeamLine = icon(Users, "duotone");
export const RiThumbDownLine = icon(ThumbsDown, "duotone");
export const RiThumbUpLine = icon(ThumbsUp, "duotone");
export const RiTicket2Line = icon(Ticket, "duotone");
export const RiTicketLine = icon(Ticket, "duotone");
export const RiTimeLine = icon(Clock, "duotone");
export const RiTimerFlashLine = icon(Timer, "duotone");
export const RiToolsLine = icon(Wrench, "duotone");
export const RiTrophyLine = icon(Trophy, "duotone");
export const RiUpload2Line = icon(UploadSimple, "duotone");
export const RiUploadCloud2Line = icon(CloudArrowUp, "duotone");
export const RiUploadLine = icon(UploadSimple, "duotone");
export const RiUser3Line = icon(User, "duotone");
export const RiUserAddLine = icon(UserPlus, "duotone");
export const RiUserFollowLine = icon(UserCheck, "duotone");
export const RiUserHeartLine = icon(Handshake, "duotone");
export const RiUserLine = icon(User, "duotone");
export const RiUserSearchLine = icon(UserFocus, "duotone");
export const RiUserSharedLine = icon(UserPlus, "duotone");
export const RiUserSmileLine = icon(Smiley, "duotone");
export const RiUserStarLine = icon(UserCheck, "duotone");
export const RiUserUnfollowLine = icon(UserMinus, "duotone");
export const RiVideoLine = icon(VideoCamera, "duotone");
export const RiVipCrown2Line = icon(Crown, "duotone");
export const RiVipCrownLine = icon(Crown, "duotone");
export const RiVolumeMuteLine = icon(SpeakerSlash, "duotone");
export const RiVolumeUpLine = icon(SpeakerHigh, "duotone");
export const RiWallet3Line = icon(Wallet, "duotone");
export const RiWalletLine = icon(Wallet, "duotone");
export const RiWifiOffLine = icon(WifiSlash, "duotone");
export const RiZzzLine = icon(Moon, "duotone");

export { RiDiscordFill, RiFacebookFill, RiGoogleFill, RiInstagramLine } from "@remixicon/react";
