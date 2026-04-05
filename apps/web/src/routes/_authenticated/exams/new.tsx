import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  BookOpen01Icon,
  RefreshIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "#/components/ui/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { api } from "#/lib/api";
import type {
  DocumentStatus,
  DocumentType,
  ExamContextSource,
  ExamDurationMode,
  ExamType,
} from "@repo/shared";
import {
  DEFAULT_EXAM_DURATION_MINUTES,
  DEFAULT_QUESTION_COUNT,
  MAX_EXAM_DURATION_MINUTES,
  MAX_QUESTION_COUNT,
  MIN_EXAM_DURATION_MINUTES,
  MIN_QUESTION_COUNT,
} from "@repo/shared";

export const Route = createFileRoute("/_authenticated/exams/new")({
  component: NewExamPage,
});

type Document = {
  id: string;
  name: string;
  status: DocumentStatus;
  type: DocumentType;
  createdAt: string;
};

type FormState = {
  title: string;
  topic: string;
  type: ExamType;
  questionCount: number;
  durationMode: ExamDurationMode;
  durationMinutes: number | null;
  contextSource: ExamContextSource;
  documentIds: string[];
};

const FORM_DEFAULTS: FormState = {
  title: "",
  topic: "",
  type: "mcq",
  questionCount: DEFAULT_QUESTION_COUNT,
  durationMode: "user_set",
  durationMinutes: DEFAULT_EXAM_DURATION_MINUTES,
  contextSource: "global",
  documentIds: [],
};

function NewExamPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(FORM_DEFAULTS);
  const [documentSearch, setDocumentSearch] = useState("");
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const { data: documents = [], isLoading: documentsLoading } = useQuery({
    queryKey: ["exam-documents"],
    queryFn: async () => {
      const res = await api.documents.get();
      if (res.data?.success) {
        const data = (res.data as { success: true; data: Document[] }).data;
        return data.filter((doc) => doc.status === "ready");
      }
      return [] as Document[];
    },
    staleTime: 60 * 1000,
  });

  const filteredDocuments = useMemo(() => {
    if (!documentSearch.trim()) return documents;
    const term = documentSearch.toLowerCase();
    return documents.filter((doc) => doc.name.toLowerCase().includes(term));
  }, [documentSearch, documents]);

  const validation = useMemo(() => {
    const errors: Partial<Record<keyof FormState, string>> = {};

    if (!form.title.trim()) {
      errors.title = "Title is required";
    }

    if (!form.topic.trim()) {
      errors.topic = "Topic is required";
    }

    if (
      form.questionCount < MIN_QUESTION_COUNT ||
      form.questionCount > MAX_QUESTION_COUNT
    ) {
      errors.questionCount = `Questions must be between ${MIN_QUESTION_COUNT} and ${MAX_QUESTION_COUNT}`;
    }

    if (form.durationMode === "user_set") {
      if (!form.durationMinutes) {
        errors.durationMinutes = "Duration is required";
      } else if (
        form.durationMinutes < MIN_EXAM_DURATION_MINUTES ||
        form.durationMinutes > MAX_EXAM_DURATION_MINUTES
      ) {
        errors.durationMinutes = `Duration must be between ${MIN_EXAM_DURATION_MINUTES} and ${MAX_EXAM_DURATION_MINUTES} minutes`;
      }
    }

    if (
      (form.contextSource === "uploaded" || form.contextSource === "both") &&
      form.documentIds.length === 0
    ) {
      errors.documentIds = "Select at least one document";
    }

    return errors;
  }, [form]);

  const hasErrors = useMemo(
    () => Object.values(validation).some(Boolean),
    [validation],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title.trim(),
        topic: form.topic.trim(),
        type: form.type,
        questionCount: form.questionCount,
        durationMode: form.durationMode,
        durationMinutes:
          form.durationMode === "user_set" ? form.durationMinutes : undefined,
        contextSource: form.contextSource,
        documentIds: form.contextSource === "global" ? [] : form.documentIds,
      };

      const res = await api.exams.post(payload);
      if (res.data?.success) {
        return (res.data as { success: true; data: { id: string } }).data;
      }

      throw new Error(
        (res.data as { error?: string } | undefined)?.error ||
          "Failed to create exam",
      );
    },
    onSuccess: (exam) => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      navigate({ to: "/exams/$examId", params: { examId: exam.id } });
    },
  });

  const requiresDocuments =
    form.contextSource === "uploaded" || form.contextSource === "both";

  const selectedDocuments = form.documentIds
    .map((id) => documents.find((doc) => doc.id === id))
    .filter((doc): doc is Document => Boolean(doc));

  const submitError =
    createMutation.error instanceof Error
      ? createMutation.error.message
      : createMutation.error
        ? "Failed to create exam"
        : null;

  return (
    <>
      <title>Create exam - Prepify</title>

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Create exam
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Start with the essentials, then tune generation settings only if
              needed.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/exams" })}
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-4"
            />
            Back to exams
          </Button>
        </div>

        <Card className="overflow-hidden border-border/70">
          <CardHeader className="border-b bg-gradient-to-r from-slate-50 to-slate-100/40 dark:from-slate-950 dark:to-slate-900">
            <CardTitle>Exam brief</CardTitle>
            <CardDescription>
              Provide a title, topic focus, and context source. Advanced options
              are optional and collapsed by default.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 p-4 sm:p-6">
            <FieldSet>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Title</FieldLabel>
                  <FieldContent>
                    <Input
                      autoFocus
                      placeholder="Physics - Kinematics practice"
                      value={form.title}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                    />
                    <FieldDescription>
                      A concise title makes the list view easier to scan.
                    </FieldDescription>
                    {validation.title && (
                      <FieldError>{validation.title}</FieldError>
                    )}
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel>Context source</FieldLabel>
                  <FieldContent>
                    <Select
                      value={form.contextSource}
                      onValueChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          contextSource: value as ExamContextSource,
                          documentIds:
                            value === "global" ? [] : prev.documentIds,
                        }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Source</SelectLabel>
                          <SelectItem value="uploaded">
                            Uploaded only
                          </SelectItem>
                          <SelectItem value="global">Global only</SelectItem>
                          <SelectItem value="both">
                            Uploaded + global
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Choose where question context should come from.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldGroup>

              <Field>
                <FieldLabel>Topic focus</FieldLabel>
                <FieldContent>
                  <Textarea
                    rows={3}
                    placeholder="Projectile motion, Newton's laws, free-body diagrams"
                    value={form.topic}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        topic: event.target.value,
                      }))
                    }
                  />
                  <FieldDescription>
                    This appears in the exams list and guides question
                    generation.
                  </FieldDescription>
                  {validation.topic && (
                    <FieldError>{validation.topic}</FieldError>
                  )}
                </FieldContent>
              </Field>

              {requiresDocuments && (
                <Field>
                  <FieldLabel>Attach documents</FieldLabel>
                  <FieldContent className="space-y-2">
                    <div className="rounded-lg border border-dashed bg-muted/30 p-3">
                      <div className="mb-2 flex flex-wrap gap-2">
                        {selectedDocuments.length === 0 ? (
                          <span className="text-sm text-muted-foreground">
                            Select one or more ready documents.
                          </span>
                        ) : (
                          selectedDocuments.map((doc) => (
                            <Badge
                              key={doc.id}
                              variant="secondary"
                              className="gap-1.5"
                            >
                              <HugeiconsIcon
                                icon={BookOpen01Icon}
                                strokeWidth={2}
                                className="size-3.5"
                              />
                              <span className="max-w-[180px] truncate text-xs">
                                {doc.name}
                              </span>
                            </Badge>
                          ))
                        )}
                      </div>

                      <Combobox
                        multiple
                        value={form.documentIds}
                        onValueChange={(value) =>
                          setForm((prev) => ({
                            ...prev,
                            documentIds: Array.isArray(value)
                              ? (value as string[])
                              : [],
                          }))
                        }
                        onInputValueChange={setDocumentSearch}
                      >
                        <ComboboxInput
                          showClear
                          placeholder={
                            documentsLoading
                              ? "Loading documents..."
                              : "Search documents"
                          }
                          disabled={documentsLoading}
                        />
                        <ComboboxContent className="max-h-64">
                          <ComboboxList>
                            {filteredDocuments.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                {documentsLoading
                                  ? "Loading..."
                                  : documentSearch
                                    ? "No matches"
                                    : "No ready documents found"}
                              </div>
                            ) : (
                              filteredDocuments.map((doc) => (
                                <ComboboxItem key={doc.id} value={doc.id}>
                                  <div className="flex flex-col">
                                    <span className="text-sm font-medium">
                                      {doc.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {doc.type}
                                    </span>
                                  </div>
                                </ComboboxItem>
                              ))
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </div>

                    {validation.documentIds && (
                      <FieldError>{validation.documentIds}</FieldError>
                    )}
                  </FieldContent>
                </Field>
              )}
            </FieldSet>

            <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Generation settings</h2>
                  <p className="text-xs text-muted-foreground">
                    Keep defaults for quick setup, or open settings to
                    customize.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={showAdvancedSettings ? "ghost" : "outline"}
                  onClick={() => setShowAdvancedSettings((prev) => !prev)}
                >
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    strokeWidth={2}
                    className="size-4"
                  />
                  {showAdvancedSettings ? "Hide settings" : "Customize"}
                </Button>
              </div>

              {!showAdvancedSettings ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">Type: {form.type}</Badge>
                  <Badge variant="outline">
                    Questions: {form.questionCount}
                  </Badge>
                  <Badge variant="outline">
                    Duration:{" "}
                    {form.durationMode === "ai_decided"
                      ? "AI decides"
                      : `${form.durationMinutes} min`}
                  </Badge>
                </div>
              ) : (
                <FieldSet className="mt-4">
                  <FieldGroup className="grid gap-4 md:grid-cols-3">
                    <Field>
                      <FieldLabel>Exam type</FieldLabel>
                      <FieldContent>
                        <Select
                          value={form.type}
                          onValueChange={(value) =>
                            setForm((prev) => ({
                              ...prev,
                              type: value as ExamType,
                            }))
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Type</SelectLabel>
                              <SelectItem value="mcq">
                                Multiple choice
                              </SelectItem>
                              <SelectItem value="written">
                                Descriptive
                              </SelectItem>
                              <SelectItem value="mixed">Mixed</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FieldContent>
                    </Field>

                    <Field>
                      <FieldLabel>Question count</FieldLabel>
                      <FieldContent>
                        <Input
                          type="number"
                          min={MIN_QUESTION_COUNT}
                          max={MAX_QUESTION_COUNT}
                          value={form.questionCount}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              questionCount: Number(event.target.value) || 0,
                            }))
                          }
                        />
                        {validation.questionCount && (
                          <FieldError>{validation.questionCount}</FieldError>
                        )}
                      </FieldContent>
                    </Field>

                    <Field>
                      <FieldLabel>Duration mode</FieldLabel>
                      <FieldContent>
                        <Select
                          value={form.durationMode}
                          onValueChange={(value) =>
                            setForm((prev) => ({
                              ...prev,
                              durationMode: value as ExamDurationMode,
                            }))
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Duration</SelectLabel>
                              <SelectItem value="user_set">
                                Set duration
                              </SelectItem>
                              <SelectItem value="ai_decided">
                                AI decides
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FieldContent>
                    </Field>
                  </FieldGroup>

                  {form.durationMode === "user_set" && (
                    <Field>
                      <FieldLabel>Duration minutes</FieldLabel>
                      <FieldContent>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            className="w-36"
                            min={MIN_EXAM_DURATION_MINUTES}
                            max={MAX_EXAM_DURATION_MINUTES}
                            value={form.durationMinutes ?? ""}
                            onChange={(event) =>
                              setForm((prev) => ({
                                ...prev,
                                durationMinutes:
                                  Number(event.target.value) || 0,
                              }))
                            }
                          />
                          <span className="text-sm text-muted-foreground">
                            minutes
                          </span>
                        </div>
                        {validation.durationMinutes && (
                          <FieldError>{validation.durationMinutes}</FieldError>
                        )}
                      </FieldContent>
                    </Field>
                  )}
                </FieldSet>
              )}
            </div>

            {submitError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-500/10 dark:text-rose-100">
                {submitError}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                After creation, you will be redirected to the exam workspace to
                monitor generation progress.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => navigate({ to: "/exams" })}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={hasErrors || createMutation.isPending}
                >
                  {createMutation.isPending && (
                    <HugeiconsIcon
                      icon={RefreshIcon}
                      strokeWidth={2}
                      className="size-4 animate-spin"
                    />
                  )}
                  Generate exam
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default NewExamPage;
