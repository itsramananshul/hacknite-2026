import {errorResponse} from "@/lib/gemini";
import {requireUser,SESSION_COOKIE} from "@/lib/request-auth";
export async function POST(request:Request){
  try {
    const {user,token}=await requireUser(request);
    const secure=new URL(request.url).protocol==="https:";
    return Response.json({userId:user.id},{headers:{"Cache-Control":"no-store","Set-Cookie":`${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure?"; Secure":""}`}});
  }catch(error){return errorResponse(error);}
}
export async function DELETE(request:Request){
  const secure=new URL(request.url).protocol==="https:";
  return new Response(null,{status:204,headers:{"Set-Cookie":`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?"; Secure":""}`,"Cache-Control":"no-store"}});
}
