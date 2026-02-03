import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { 
  Loader2, 
  CheckCircle2, 
  XCircle,
  ArrowLeft, 
  ArrowRight,
  ClipboardCheck,
  Award,
  AlertTriangle,
  ExternalLink,
  RotateCcw
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Question {
  id: number;
  question: string;
  options: { key: string; text: string }[];
  correctAnswer: string;
  explanation: string;
}

const ASSESSMENT_QUESTIONS: Question[] = [
  {
    id: 1,
    question: "When cleaning a bathroom, how many trips around the room should you make?",
    options: [
      { key: "A", text: "One trip – clean everything at once" },
      { key: "B", text: "Two trips – first for wet areas, second for dry areas" },
      { key: "C", text: "Three trips – one for each fixture" },
      { key: "D", text: "As many as needed" },
    ],
    correctAnswer: "B",
    explanation: "Two trips: Round 1 tackles wet areas (shower, tub, sink inside, toilet inside), Round 2 handles dry areas (toilet exterior, mirror, cabinets, floor)."
  },
  {
    id: 2,
    question: "What is the correct technique when using a duster in dry areas?",
    options: [
      { key: "A", text: "Flick the duster quickly to spread dust around" },
      { key: "B", text: "Use even, steady motions and come to a dead stop at the end of each stroke" },
      { key: "C", text: "Only dust surfaces at eye level" },
      { key: "D", text: "Dust in circular motions" },
    ],
    correctAnswer: "B",
    explanation: "Even, steady motions with a dead stop lets dust cling to the duster instead of floating into the air."
  },
  {
    id: 3,
    question: "Which statement about cleaning chemicals is TRUE?",
    options: [
      { key: "A", text: "Mixing bleach and ammonia creates a stronger cleaner" },
      { key: "B", text: "You can mix chemicals if they're the same brand" },
      { key: "C", text: "Never mix cleaning chemicals" },
      { key: "D", text: "Only mix chemicals outdoors" },
    ],
    correctAnswer: "C",
    explanation: "Never mix cleaning chemicals. This is a strict safety rule that must be followed 100% of the time."
  },
  {
    id: 4,
    question: "What is the most important tip for vacuuming efficiently?",
    options: [
      { key: "A", text: "Vacuum each room separately, unplugging between rooms" },
      { key: "B", text: "Plug the vacuum in once and vacuum the entire house without replugging" },
      { key: "C", text: "Start with the bedroom and end with the kitchen" },
      { key: "D", text: "Always use the highest suction setting" },
    ],
    correctAnswer: "B",
    explanation: "Plug in once and vacuum the entire house (typically at the end of the clean) without replugging."
  },
  {
    id: 5,
    question: "If you arrive at a client's home and see fleas, cockroaches, or mouse droppings, what should you do?",
    options: [
      { key: "A", text: "Vacuum quickly to help the client" },
      { key: "B", text: "Use extra disinfectant and continue cleaning" },
      { key: "C", text: "Call the office immediately and DO NOT use your vacuum" },
      { key: "D", text: "Ask the client for permission to continue" },
    ],
    correctAnswer: "C",
    explanation: "Call the office immediately and do NOT use your vacuum to prevent transferring pests or disease to other clients."
  },
  {
    id: 6,
    question: "Why might you be required to carry two cleaning totes?",
    options: [
      { key: "A", text: "To have backup supplies" },
      { key: "B", text: "To separate bathroom tools from the rest of the house and prevent cross-contamination" },
      { key: "C", text: "To look more professional" },
      { key: "D", text: "To carry more products" },
    ],
    correctAnswer: "B",
    explanation: "A 'dirty' tote for bathrooms and a 'clean' tote for the rest of the house prevents cross-contamination."
  },
  {
    id: 7,
    question: "Which of the following should you NEVER use when washing microfiber cloths?",
    options: [
      { key: "A", text: "Warm water" },
      { key: "B", text: "Gentle liquid detergent" },
      { key: "C", text: "Fabric softener, bleach, or hot water" },
      { key: "D", text: "A dishwasher" },
    ],
    correctAnswer: "C",
    explanation: "Never use powdered detergents, fabric softener, bleach, or hot water. Also never wash microfiber with cotton."
  },
  {
    id: 8,
    question: "If you break something at a client's home, what should you do?",
    options: [
      { key: "A", text: "Hide it and hope they don't notice" },
      { key: "B", text: "Tell the customer or leave a note on the kitchen counter AND notify the office immediately" },
      { key: "C", text: "Replace it yourself before leaving" },
      { key: "D", text: "Wait until the next visit to mention it" },
    ],
    correctAnswer: "B",
    explanation: "Tell the customer or leave a note AND let the office know immediately so they can reach out to the customer."
  },
  {
    id: 9,
    question: "What should you do if you're going to run more than 30 minutes over the scheduled time?",
    options: [
      { key: "A", text: "Just finish and leave late" },
      { key: "B", text: "Leave on time even if not finished" },
      { key: "C", text: "Call the office anytime you think you'll go over more than 30 minutes" },
      { key: "D", text: "Text the customer directly" },
    ],
    correctAnswer: "C",
    explanation: "Call the office anytime you think you will go over more than 30 minutes."
  },
  {
    id: 10,
    question: "In the bedroom, what should you do FIRST before dusting and cleaning?",
    options: [
      { key: "A", text: "Vacuum the floor" },
      { key: "B", text: "Open the windows" },
      { key: "C", text: "Make the bed" },
      { key: "D", text: "Dust the furniture" },
    ],
    correctAnswer: "C",
    explanation: "Make the bed first. That way the dust created by making the bed won't settle on already cleaned surfaces."
  },
];

const PASSING_SCORE = 8; // 80% = 8 out of 10

export default function CleanerAssessment() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cleanerId, setCleanerId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showResults, setShowResults] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);
  const [previousAttempts, setPreviousAttempts] = useState(0);
  const [alreadyTrained, setAlreadyTrained] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error("Please sign in to take the assessment");
        navigate("/cleaner/auth");
        return;
      }

      // Check if user has completed onboarding
      const { data: cleaner, error } = await supabase
        .from("cleaners")
        .select("id, is_trained, assessment_attempts, assessment_score")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error || !cleaner) {
        toast.error("Please complete onboarding before taking the assessment");
        navigate("/cleaner/onboarding");
        return;
      }

      setCleanerId(cleaner.id);
      setPreviousAttempts(cleaner.assessment_attempts || 0);
      
      if (cleaner.is_trained) {
        setAlreadyTrained(true);
        setResult({ score: cleaner.assessment_score || 10, passed: true });
        setShowResults(true);
      }

      setLoading(false);
    } catch (error) {
      console.error("Auth check error:", error);
      navigate("/cleaner/auth");
    }
  };

  const selectAnswer = (questionId: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const goToNext = () => {
    if (currentQuestion < ASSESSMENT_QUESTIONS.length - 1) {
      setCurrentQuestion(prev => prev + 1);
    }
  };

  const goToPrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(prev => prev - 1);
    }
  };

  const calculateScore = (): number => {
    let score = 0;
    ASSESSMENT_QUESTIONS.forEach(q => {
      if (answers[q.id] === q.correctAnswer) {
        score++;
      }
    });
    return score;
  };

  const submitAssessment = async () => {
    if (!cleanerId) {
      toast.error("Session error. Please refresh and try again.");
      return;
    }

    const answeredCount = Object.keys(answers).length;
    if (answeredCount < ASSESSMENT_QUESTIONS.length) {
      toast.error(`Please answer all questions (${answeredCount}/${ASSESSMENT_QUESTIONS.length} answered)`);
      return;
    }

    setSubmitting(true);
    const score = calculateScore();

    try {
      const { data, error } = await supabase.rpc('submit_cleaner_assessment', {
        p_cleaner_id: cleanerId,
        p_answers: answers,
        p_score: score,
        p_total: ASSESSMENT_QUESTIONS.length
      });

      if (error) throw error;

      const passed = score >= PASSING_SCORE;
      setResult({ score, passed });
      setShowResults(true);

      if (passed) {
        toast.success("Congratulations! You passed the assessment!");
      } else {
        toast.error(`You scored ${score}/10. You need 8/10 to pass.`);
      }
    } catch (error: any) {
      console.error("Submit error:", error);
      toast.error("Failed to submit assessment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const retakeAssessment = () => {
    setAnswers({});
    setCurrentQuestion(0);
    setShowResults(false);
    setResult(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto border border-border">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">Loading assessment...</p>
        </div>
      </div>
    );
  }

  // Results Screen
  if (showResults && result) {
    const percentage = Math.round((result.score / ASSESSMENT_QUESTIONS.length) * 100);
    
    return (
      <div className="min-h-screen bg-background py-6 px-4">
        <div className="max-w-sm mx-auto">
          <Card className="border border-border shadow-md">
            <CardHeader className="text-center pb-4">
              <div className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3",
                result.passed 
                  ? "bg-green-500/10 border border-green-500/20" 
                  : "bg-red-500/10 border border-red-500/20"
              )}>
                {result.passed ? (
                  <Award className="w-8 h-8 text-green-600" />
                ) : (
                  <XCircle className="w-8 h-8 text-red-500" />
                )}
              </div>
              <CardTitle className="text-xl">
                {result.passed ? "Assessment Passed!" : "Assessment Not Passed"}
              </CardTitle>
              <CardDescription>
                {result.passed 
                  ? "You're now a certified trained cleaner" 
                  : "You need 80% (8/10) to pass"
                }
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-4">
              {/* Score Display */}
              <div className="bg-muted/30 rounded-xl p-4 border border-border text-center">
                <p className="text-4xl font-bold mb-1">
                  <span className={result.passed ? "text-green-600" : "text-red-500"}>
                    {result.score}
                  </span>
                  <span className="text-muted-foreground text-2xl">/10</span>
                </p>
                <p className="text-sm text-muted-foreground">{percentage}% correct</p>
                <Progress 
                  value={percentage} 
                  className={cn("h-2 mt-3", result.passed ? "bg-green-100" : "bg-red-100")}
                />
              </div>

              {result.passed ? (
                <>
                  {/* Trained Badge */}
                  <div className="bg-green-500/10 rounded-xl p-4 border border-green-500/20">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-sm text-green-700">Trained Cleaner Status</p>
                        <p className="text-xs text-green-600">
                          You now qualify for premium, higher-paying jobs
                        </p>
                      </div>
                    </div>
                  </div>

                  <Button 
                    className="w-full h-11 text-sm border border-primary/20"
                    onClick={() => navigate("/cleaner/dashboard")}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Dashboard
                  </Button>
                </>
              ) : (
                <>
                  {/* Training Link */}
                  <div className="bg-amber-500/10 rounded-xl p-4 border border-amber-500/20">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm text-amber-700">Training Recommended</p>
                        <p className="text-xs text-amber-600 mb-3">
                          Complete our training program to improve your skills and retake the assessment.
                        </p>
                        <Button 
                          variant="outline"
                          size="sm"
                          className="w-full h-9 text-xs border-amber-500/30 text-amber-700 hover:bg-amber-500/10"
                          onClick={() => window.open("https://training.novaracleaning.com", "_blank")}
                        >
                          <ExternalLink className="w-3 h-3 mr-1.5" />
                          Start Training
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Review Answers */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase">Review Answers</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {ASSESSMENT_QUESTIONS.map((q) => {
                        const isCorrect = answers[q.id] === q.correctAnswer;
                        return (
                          <div 
                            key={q.id}
                            className={cn(
                              "p-2.5 rounded-lg border text-xs",
                              isCorrect 
                                ? "bg-green-500/5 border-green-500/20" 
                                : "bg-red-500/5 border-red-500/20"
                            )}
                          >
                            <div className="flex items-start gap-2">
                              {isCorrect ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 flex-shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                              )}
                              <div>
                                <p className="font-medium line-clamp-1">Q{q.id}: {q.question.slice(0, 40)}...</p>
                                {!isCorrect && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    Correct: {q.correctAnswer}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button 
                      variant="outline"
                      className="flex-1 h-10 text-sm border border-border"
                      onClick={() => navigate("/cleaner/dashboard")}
                    >
                      <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                      Dashboard
                    </Button>
                    <Button 
                      className="flex-1 h-10 text-sm border border-primary/20"
                      onClick={retakeAssessment}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      Retake
                    </Button>
                  </div>
                </>
              )}

              {previousAttempts > 0 && !alreadyTrained && (
                <p className="text-[10px] text-center text-muted-foreground">
                  Attempt #{previousAttempts + 1}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Question Screen
  const question = ASSESSMENT_QUESTIONS[currentQuestion];
  const progress = ((currentQuestion + 1) / ASSESSMENT_QUESTIONS.length) * 100;
  const answeredCount = Object.keys(answers).length;

  return (
    <div className="min-h-screen bg-background py-4 px-4">
      <div className="max-w-sm mx-auto">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 px-2 border border-border"
              onClick={() => navigate("/cleaner/dashboard")}
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Exit
            </Button>
            <Badge variant="secondary" className="text-xs border border-border">
              {answeredCount}/{ASSESSMENT_QUESTIONS.length} answered
            </Badge>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Question Card */}
        <Card className="border border-border shadow-md">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
                <span className="text-sm font-bold text-primary">{question.id}</span>
              </div>
              <span className="text-xs text-muted-foreground">of {ASSESSMENT_QUESTIONS.length}</span>
            </div>
            <CardTitle className="text-base leading-snug">{question.question}</CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-2">
            {question.options.map((option) => {
              const isSelected = answers[question.id] === option.key;
              return (
                <button
                  key={option.key}
                  onClick={() => selectAnswer(question.id, option.key)}
                  className={cn(
                    "w-full p-3 rounded-lg border text-left transition-all",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border text-xs font-semibold",
                      isSelected
                        ? "bg-primary text-white border-primary"
                        : "bg-muted text-muted-foreground border-border"
                    )}>
                      {option.key}
                    </div>
                    <p className="text-sm">{option.text}</p>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            onClick={goToPrevious}
            disabled={currentQuestion === 0}
            className="flex-1 h-10 text-sm border border-border"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Previous
          </Button>
          
          {currentQuestion < ASSESSMENT_QUESTIONS.length - 1 ? (
            <Button
              onClick={goToNext}
              disabled={!answers[question.id]}
              className="flex-1 h-10 text-sm border border-primary/20"
            >
              Next
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={submitAssessment}
              disabled={submitting || answeredCount < ASSESSMENT_QUESTIONS.length}
              className="flex-1 h-10 text-sm bg-gradient-to-r from-primary to-purple-600 border-0"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <ClipboardCheck className="w-3.5 h-3.5 mr-1.5" />
                  Submit
                </>
              )}
            </Button>
          )}
        </div>

        {/* Question Navigator */}
        <div className="mt-4 p-3 bg-muted/30 rounded-lg border border-border">
          <p className="text-[10px] text-muted-foreground uppercase mb-2">Quick Nav</p>
          <div className="flex flex-wrap gap-1.5">
            {ASSESSMENT_QUESTIONS.map((q, index) => {
              const isAnswered = !!answers[q.id];
              const isCurrent = index === currentQuestion;
              return (
                <button
                  key={q.id}
                  onClick={() => setCurrentQuestion(index)}
                  className={cn(
                    "w-7 h-7 rounded-md text-xs font-medium border transition-all",
                    isCurrent && "ring-2 ring-primary ring-offset-1",
                    isAnswered 
                      ? "bg-primary/10 text-primary border-primary/30" 
                      : "bg-muted text-muted-foreground border-border"
                  )}
                >
                  {q.id}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-[10px] text-center text-muted-foreground mt-4">
          NovaraCleaning Contractor Assessment • 80% required to pass
        </p>
      </div>
    </div>
  );
}
