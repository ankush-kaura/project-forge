import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, HelpCircle, Send, SkipForward } from "lucide-react"
import type { ClarifyingQuestion } from "@/types"

interface QuestionCardProps {
  question: ClarifyingQuestion
  onAnswer: (questionId: string, answer: string) => Promise<void>
  onSkip?: (questionId: string) => void
  disabled?: boolean
}

export function QuestionCard({ question, onAnswer, onSkip, disabled = false }: QuestionCardProps) {
  const [selectedSingle, setSelectedSingle] = useState<string>("")
  const [selectedMulti, setSelectedMulti] = useState<string[]>([])
  const [textAnswer, setTextAnswer] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const isAnswered = question.status === "answered" || question.status === "skipped"

  const handleSubmit = async () => {
    const answer =
      question.question_type === "multiple_choice"
        ? selectedMulti.join(", ")
        : question.question_type === "text"
          ? textAnswer
          : selectedSingle

    if (!answer.trim()) return
    setSubmitting(true)
    await onAnswer(question.documentId, answer)
    setSubmitting(false)
  }

  const toggleMulti = (opt: string) => {
    setSelectedMulti(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])
  }

  return (
    <Card className={isAnswered ? "opacity-70" : ""}>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">{question.question_text}</p>
            {question.context && (
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <HelpCircle className="h-3 w-3 mt-0.5 shrink-0" />
                {question.context}
              </p>
            )}
          </div>
          {isAnswered && (
            <Badge variant="secondary" className="shrink-0">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {question.status === "skipped" ? "Skipped" : "Answered"}
            </Badge>
          )}
        </div>

        {isAnswered ? (
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-sm">
              <span className="text-muted-foreground">Answer: </span>
              {question.answer || "Skipped"}
            </p>
          </div>
        ) : (
          <>
            {/* Single Choice */}
            {question.question_type === "single_choice" && (
              <div className="space-y-2">
                {(question.options || []).map((opt, i) => (
                  <label
                    key={i}
                    className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                      selectedSingle === opt
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={question.documentId}
                      value={opt}
                      checked={selectedSingle === opt}
                      onChange={(e) => setSelectedSingle(e.target.value)}
                      className="sr-only"
                      disabled={disabled || submitting}
                    />
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      selectedSingle === opt ? "border-primary" : "border-muted-foreground/30"
                    }`}>
                      {selectedSingle === opt && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                    </span>
                    <span className="text-sm">{opt}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Multiple Choice */}
            {question.question_type === "multiple_choice" && (
              <div className="space-y-2">
                {(question.options || []).map((opt, i) => (
                  <label
                    key={i}
                    className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                      selectedMulti.includes(opt)
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedMulti.includes(opt)}
                      onChange={() => toggleMulti(opt)}
                      className="sr-only"
                      disabled={disabled || submitting}
                    />
                    <span className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
                      selectedMulti.includes(opt) ? "border-primary bg-primary" : "border-muted-foreground/30"
                    }`}>
                      {selectedMulti.includes(opt) && (
                        <CheckCircle2 className="h-3 w-3 text-white" />
                      )}
                    </span>
                    <span className="text-sm">{opt}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Boolean */}
            {question.question_type === "boolean" && (
              <div className="flex gap-2">
                {["Yes", "No"].map((opt) => (
                  <Button
                    key={opt}
                    variant={selectedSingle === opt ? "default" : "outline"}
                    onClick={() => setSelectedSingle(opt)}
                    disabled={disabled || submitting}
                    className="flex-1"
                  >
                    {opt}
                  </Button>
                ))}
              </div>
            )}

            {/* Text */}
            {question.question_type === "text" && (
              <Textarea
                placeholder="Type your answer..."
                value={textAnswer}
                onChange={(e) => setTextAnswer(e.target.value)}
                disabled={disabled || submitting}
                rows={3}
              />
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={handleSubmit} disabled={disabled || submitting} size="sm">
                <Send className="h-3 w-3 mr-1" />
                {submitting ? "Saving..." : "Submit"}
              </Button>
              {onSkip && (
                <Button variant="ghost" size="sm" disabled={disabled || submitting} onClick={() => onSkip(question.documentId)}>
                  <SkipForward className="h-3 w-3 mr-1" />
                  Skip
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
