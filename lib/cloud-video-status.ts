import {RouteError} from "./gemini";

// Cloud workflows belong to the deployed app, not the local workflow runtime.
export async function cloudVideoStatus(id:string,token:string) {
  const origin=new URL(process.env.CHALK_CLOUD_APP_URL || "https://chalk.anshulraman.com");
  if(origin.protocol!=="https:")throw new RouteError(503,"cloud_video_configuration","The cloud video app must use HTTPS.");
  try {
    const response=await fetch(new URL(`/api/video/${id}`,origin),{
      headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:AbortSignal.timeout(20_000),redirect:"error",
    });
    const result=await response.json();
    if(!response.ok)throw new Error(result.error || "Cloud progress is temporarily unavailable.");
    if(!["ready","rendering","error"].includes(result.status) || typeof result.message!=="string")throw new Error("Invalid cloud video status.");
    return {status:result.status as string,message:result.message as string,narration:result.narration===true};
  }catch(error){throw new RouteError(502,"cloud_video_unavailable",`Could not check the cloud video. Try again in a moment. ${error instanceof Error?error.message:""}`);}
}
