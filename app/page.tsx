"use client";

import { SignInButton } from "@clerk/clerk-react";
import { useConvexAuth } from "convex/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Lecture } from "../convex/posts";

import { TrashIcon, MagnifyingGlassIcon, PersonIcon, QuestionMarkIcon } from "@radix-ui/react-icons";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";

import { ScreenSpinner } from "@/app/ScreenSpinner";
import { Input } from "@/components/ui/input";
import { ModeToggle } from "./ModeToggle";
import React, { useState, useRef, useEffect, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from 'react-markdown';
import { Audiogram } from "@/components/ui/line-chart";

import { Id } from "@/convex/_generated/dataModel";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import CollapsibleHeading from "./components/CollapsibleHeading";

export default function HomePage() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const BACKEND_ROOT_URL = "http://localhost:8000";

  const [concision, setConcision] = useState([0.5]);
  const [distractionMode, setDistractionMode] = useState(false);
  const [title, setTitle] = useState("");

  const { toast } = useToast();

  const lectures = useQuery(api.posts.allLectures);
  const [selectedNote, setSelectedNote] = useState<Id<"lectures"> | null>(null);

  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [questionHistory, setQuestionHistory] = useState<string[]>([]);

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [audioData, setAudioData] = useState<number[]>(new Array(200).fill(100));
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const isLookingHistory = useRef<boolean[]>([]);


  const [transcription, setTranscription] = useState("");
  const [summary, setSummary] = useState("");
  const createLecture = useMutation(api.posts.createLecture);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // use effect distraction mode localStorage setItem
  useEffect(() => {
    if (distractionMode) {
      localStorage.setItem("distractionMode", "true");
    } else {
      localStorage.setItem("distractionMode", "false");
    }
  }, [distractionMode]);

  useEffect(() => {
    localStorage.removeItem("stop");
  }, []);

  // similar for concision
  useEffect(() => {
    if (concision) {
      localStorage.setItem("concision", concision[0].toString());
    }
  }, [concision, setConcision]);

  const [signalSupport, setSignalSupport] = useState({
    "Slow down": true,
    "Speed up": true,
    "Pause": true,
    "Unpause": true,
  });
  const nameEmojiMap: Record<string, string> = {
    "Slow down": "🙏",
    "Speed up": "👊",
    "Pause": "🤚",
    "Unpause": "👍",
  };



  const handleActionButton = (action: string) => {
    switch (action) {
      case "Slow down":
        setIsOpen(true);
        setConcision([0.25]);
        break;
      case "Speed up":
        setIsOpen(false);
        setConcision([0.5]);
        break;
      case "Pause":
        setConcision([1]);
        break;
      case "Unpause":
        setConcision([0.5]);
        break;
    }
  };

  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }

    if (audioStream) {
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      const source = audioContextRef.current.createMediaStreamSource(audioStream);
      source.connect(analyserRef.current);

      const updateAudioData = () => {
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteTimeDomainData(dataArray);
          setAudioData(prevData => {
            const newData = [...prevData.slice(1), Math.max(...Array.from(dataArray))];
            return newData;
          });
        }
        requestAnimationFrame(updateAudioData);
      };

      updateAudioData();
    }

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [cameraStream, audioStream]);

  useEffect(() => {
    if (generatingNotes) {
      const intervalId = setInterval(async () => {
        try {
          let isLooking = true;

          // Face detection. Must be set once before running.
          if (distractionMode || localStorage.getItem("distractionMode") === "true") {
            const faceResponse = await fetch(`${BACKEND_ROOT_URL}/face-detection`);
            isLooking = (await faceResponse.json()).res;
            // Update isLooking history
            isLookingHistory.current = [...isLookingHistory.current.slice(-2), isLooking];
          }

          // Gesture recognition
          const gestureResponse = await fetch(`${BACKEND_ROOT_URL}/gesture-recognition`);
          const gestureData = await gestureResponse.json();
          const lastShowedToast = localStorage.getItem("lastShowedToast");
          const lastShowedToastTime = lastShowedToast ? new Date(parseInt(lastShowedToast)).getTime() : 0;

          // Apply rules
          if (isLookingHistory.current.length === 3 && isLookingHistory.current.every(val => val === false)) {
            if (Date.now() - lastShowedToastTime > 10000) {
              toast({
                title: "Detected distraction",
                description: "We've detected that you're looking away from the screen. We've lowered concision to make the notes more understandable.",
              });
              localStorage.setItem("lastShowedToast", Date.now().toString());
            }
            setConcision([0.25]);
          } else if (gestureData.handsPrayer) { // Slow down
            console.log("Prayer hands detected");
            setIsOpen(true);
            setConcision([0.25]);
          } else if (gestureData.fist) { // Speed up
            setConcision([0.75]);
          } else if (gestureData.stopSign) { // Pause
            setConcision([1]);
          } else if (gestureData.thumbsUp) { // Unpause
            setConcision([0.5]);
          }
        } catch (error) {
          console.error("Error fetching detection data:", error);
        }
      }, 1000); // Check every second

      return () => clearInterval(intervalId);
    }
  }, [generatingNotes, BACKEND_ROOT_URL]);

  const startGeneratingNotes = async () => {
    localStorage.removeItem("stop");
    setGeneratingNotes(true);
    if ('mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" }
        });
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true
        });
        setCameraStream(videoStream);
        setAudioStream(audioStream);

        // Start processing audio
        processAudio(audioStream);
      } catch (error) {
        console.error("Error accessing audio:", error);
      }
    } else {
      console.error("Media devices and getUserMedia are not supported.");
    }
  };


  const processAudio = async (stream: MediaStream) => {
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      chunks.push(e.data);
    };

    recorder.onstop = async () => {
      const audioBlob = new Blob(chunks, { type: 'audio/wav' });
      await sendAudioForTranscription(audioBlob);
    };

    // Record in 5-second intervals
    const interval = setInterval(() => {
      recorder.stop();
      try {
        recorder.start();
      } catch (error) {
        console.error("Error starting recording:", error);
      }
    }, 10_000);

    recorder.start();

    // Clean up function
    return () => {
      console.log("Cleaning up audio recording");
      clearInterval(interval);
      recorder.stop();
    };
  };

  const sendAudioForTranscription = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');

    try {
      if (localStorage.getItem("concision") && parseFloat(localStorage.getItem("concision")!) < 1 && localStorage.getItem("stop") !== "true") {
        const response = await fetch('http://localhost:8000/api/transcribe', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        setTranscription(prev => prev + ' ' + data.transcription);

        // Get summary
        const summaryResponse = await fetch('http://localhost:8000/api/summarize');
        const summaryData = await summaryResponse.json();
        setSummary(summaryData.summary);
      }
    } catch (error) {
      console.error('Error sending audio for transcription:', error);
    }
  };

  const stopRecording = async (save: boolean = true) => {
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
    }
  
    cameraStream?.getTracks().forEach(function (track) {
      track.stop();
    });
  
    localStorage.setItem("stop", "true");
  
    setCameraStream(null);
    setAudioStream(null);
    setGeneratingNotes(false);
  
    if (save) {
      try {
        // Process the summary to remove duplicate h1 headings and ensure alternating structure
        const processedSummary = summary.split('\n').reduce((acc, line, index, arr) => {
          if (line.startsWith('# ')) {
            // If this is an h1 and the previous line was also an h1, skip this line
            if (index > 0 && arr[index - 1].startsWith('# ')) {
              return acc;
            }
            // If this is an h1 and the previous line was empty (meaning the line before that was a paragraph), add it
            if (index === 0 || (index > 1 && arr[index - 1].trim() === '' && !arr[index - 2].startsWith('# '))) {
              return acc + line + '\n';
            }
            // Otherwise, add an empty line before the h1
            return acc + '\n' + line + '\n';
          } else {
            // For non-h1 lines (paragraphs), add them as is
            return acc + line + '\n';
          }
        }, '').trim();
  
        await createLecture({
          title: title || 'Untitled Lecture',
          transcription: processedSummary,
        });
      } catch (error) {
        console.error('Error saving lecture:', error);
      }
    }
  };

  const renderSummary = (): ReactNode => {
    if (!summary) {
      return "Your generated, realtime, hand-assisted notes will appear here...";
    }

    // Split sections and filter out empty lines

    const sections = summary.split('#').filter(section => section.trim() !== '' || section !== "#").filter(section => section.trim() !== '' || section.length > 1);

    return sections.map((section, index) => {
      // Split each section into heading and content, filtering out empty content lines
      const [heading, ...contentLines] = section.split('\n').filter(line => line.trim() !== '');
      const content = contentLines.join(' '); // Join content lines into a single paragraph

      if (content.trim() === '') return null;

      return (
        <CollapsibleHeading
          key={index}
          heading={heading}
          content={<p>{content + '\n'}</p>}
          isOpen={index === sections.length - 1 ? isOpen : false}
          setIsOpen={setIsOpen}
        />
      );
    });
  };

  const submitQuestion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let context = lectures?.find(item => item._id === selectedNote)?.transcription || '';

    try {
      const response = await fetch('http://localhost:8000/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question, context, questionHistory }),
      });

      const answer = await response.json();
      setQuestionHistory([...questionHistory, question, answer.response]);
      setQuestion("");

      console.log(answer);
      console.log(questionHistory);

      return answer;
    } catch (error) {
      console.error('Error submitting question:', error);
    }
  };

  useEffect(() => {
    setQuestionHistory([]);
  }, [selectedNote]);

  return isAuthenticated ? (
    <>
      <div className="h-full flex flex-col">
        <div className="flex flex-col items-start justify-between space-y-2 py-4 sm:flex-row sm:items-center sm:space-y-0 md:h-16">
          <h2 className="text-lg font-semibold flex gap-x-2 items-center cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" className="icon icon-tabler icon-tabler-note size-8 m-auto dark:!text-white" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M13 20l7 -7" />
            <path d="M13 20v-6a1 1 0 0 1 1 -1h6v-7a2 2 0 0 0 -2 -2h-12a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7" />
          </svg>NoteHacks</h2>
          <div className="ml-auto flex w-full space-x-2 sm:justify-end items-center">
            <ModeToggle />

            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 size-6" />
              <Input type="text" placeholder="Search your notes..." className="!pl-10 min-w-[20rem]" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button variant="outline" size="icon" className="rounded-full !p-0"><PersonIcon strokeWidth={2} /></Button>
          </div>
        </div>
        <Separator />
        <div className="h-full py-6">
          <div className="grid grid-cols-5">
            <div className={"items-stretch col-span-4 overflow-y-hidden pr-8 flex flex-col gap-x-4 w-full"}>
              {/* title, model, concision, signal support */}
              <div className="flex flex-row gap-4 items-center mb-4 mt-0.5 ml-0.5">
                <Input type="text" placeholder="CS 3110, Lecture 2" value={title} onChange={(e) => setTitle(e.target.value)} />

                <div className="flex flex-row gap-2 items-center">
                  <Label htmlFor="distraction-mode" className="font-semibold w-32">Anti-Distraction</Label>
                  <Switch
                    id="distraction-mode"
                    checked={distractionMode}
                    onCheckedChange={setDistractionMode}
                    className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4"
                    aria-label="Distraction Mode"
                  />
                </div>

                <div className="flex flex-row gap-2 items-center">
                  <Label htmlFor="concision" className="font-semibold">Concision</Label>
                  <span className="rounded-md border border-transparent px-2 py-0.5 text-right text-sm text-muted-foreground hover:border-border">
                    {concision}
                  </span>
                  <Slider
                    id="concision"
                    max={1}
                    value={concision}
                    step={0.01}
                    onValueChange={setConcision}
                    className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4 w-20"
                    aria-label="Concision"
                  />
                </div>

                <div className="flex flex-row gap-x-3 flex-nowrap items-start">
                  {Object.entries(signalSupport).map(([key, value]) => (
                    <div key={key} className="flex flex-col items-center justify-between gap-y-2">
                      <div className="flex items-center justify-between gap-x-2" >
                        <Checkbox checked={value} className="accent-black cursor-pointer" id={key} onClick={() => setSignalSupport(prev => ({ ...prev, [key]: !value }))} />
                        {/* <Label className="flex items-center gap-x-2 w-max flex-nowrap text-nowrap" htmlFor={key}>{key} {nameEmojiMap[key]}</Label> */}
                        <Button
                          onClick={() => handleActionButton(key)}
                          className="w-full flex items-center justify-center flex-nowrap text-nowrap"
                          variant="outline"
                          size="sm"
                        >
                          {key} {nameEmojiMap[key]}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

              </div>
              <div className="flex flex-row gap-x-4">
                <div className="flex flex-col space-y-4 w-full">
                  {selectedNote === null ? (
                    <div className="min-h-[400px] flex-1 p-4 md:min-h-[640px] lg:min-h-[640px] max-h-[640px] bg-gray-200 border border-gray-300 rounded-md dark:bg-gray-800 dark:border-gray-700 prose dark:prose-invert !max-w-full overflow-y-auto">
                      {renderSummary()}
                    </div>
                  ) : (

                    // TODO: CHAT BOX that is currently integrated with the notes lol
                    <div className="min-h-[400px] flex-1 p-4 md:min-h-[640px] lg:min-h-[640px] bg-gray-200 border border-gray-300 rounded-md dark:bg-gray-800 dark:border-gray-700 prose dark:prose-invert max-h-[640px] overflow-y-scroll !max-w-full prose-headings:mt-0 prose-headings:mb-4 prose-p:mt-0 prose-p:mb-2 !leading-snug">
                      <ReactMarkdown>
                        {lectures?.find(item => item._id === selectedNote)?.transcription || ''}
                      </ReactMarkdown>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    {selectedNote === null ? (
                      generatingNotes ? (
                        <Button onClick={() => stopRecording(true)}>Save recording</Button>
                      ) : (
                        <Button onClick={startGeneratingNotes}>Start recording</Button>
                      )
                    ) : (
                      <Button variant="outline" onClick={() => setSelectedNote(null)}>Back to new note</Button>
                    )}
                    {!selectedNote && generatingNotes && <>
                      <Button variant="destructive" onClick={() => stopRecording(false)}>
                        <span className="sr-only">Cancel generation</span>
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                      {audioStream && (
                        <div className="w-full">
                          <Audiogram data={audioData} width={850} height={40} />
                        </div>
                      )}</>}
                  </div>
                </div>
                {selectedNote && <div className="w-[500px] rounded-md border border-gray-300 dark:border-gray-700 p-4 max-h-[640px] overflow-y-auto"> <div className="flex flex-col gap-y-2">
                  {questionHistory.map((item, index) => {
                    return (
                      <div key={index}>
                        <ReactMarkdown>{
                          index % 2 == 1 ? '**[System]:** ' + item : '**[You]:** ' +
                            item}</ReactMarkdown>
                      </div>
                    );
                  })}
                  <div className={"relative align-baseline" + (questionHistory.length > 0 ? " mt-4" : "")}>
                    <QuestionMarkIcon className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 size-6" />
                    <form onSubmit={submitQuestion}>
                      <Input type="text" placeholder="Got a question?" className="!pl-10 bg-white dark:bg-gray-600" value={question} onChange={(e) => setQuestion(e.target.value)} />
                    </form>
                  </div>
                </div>
                </div>
                }
              </div>
            </div>
            <div className="hidden flex-col space-y-4 sm:flex md:order-2 h-full overflow-y-auto border-l pl-8 border-gray-200 dark:border-gray-800">
              <h2 className="font-semibold text-center underline">Past Notes</h2>
              <div className="flex flex-col gap-y-4 items-center justify-between max-h-[450px] overflow-y-auto">
                {lectures === undefined ? (
                  <ScreenSpinner />
                ) : (
                  lectures
                    .filter((item: Lecture) =>
                      item.title.toLowerCase().includes(search.toLowerCase())
                    )
                    .map((item: Lecture) => (
                      <Badge
                        key={item._id}
                        variant={selectedNote === item._id ? "default" : "outline"}
                        className="flex flex-col text-center items-center justify-between !text-sm cursor-pointer"
                        onClick={() => setSelectedNote(item._id)}
                      >
                        <span className="italic mb-0.5">
                          {item.title}
                        </span><span>{new Date(item._creationTime).toLocaleTimeString()}&nbsp;&nbsp;&bull;&nbsp;&nbsp;{new Date(item._creationTime).toLocaleDateString()}
                        </span>
                      </Badge>
                    ))
                )}
              </div>
              <div className="flex-grow" />
              <div className={"hidden flex-col space-y-4 sm:flex md:order-2 w-[200px] mx-auto " + (selectedNote ? "!hidden" : "")}>
                {/* Add camera feed and audiogram */}
                {(cameraStream || audioStream) && (
                  <div className="mt-4 !mb-[3.5rem] flex flex-col gap-4">
                    {cameraStream && (
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-auto rounded-md"
                      />
                    )}
                  </div>
                )}
                {!cameraStream && !audioStream && (
                  <div className="mt-4 !mb-[3.25rem] bg-gray-200 border border-gray-300 rounded-md dark:bg-gray-800 dark:border-gray-700 prose dark:prose-invert h-40 text-center items-center flex justify-center italic text-xs">
                    <p>No recording in progress.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div >
    </>
  ) : (
    isLoading ? <ScreenSpinner /> : <div className="lds-screen-container"><SignInButton /></div>
  );
}
