import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import { homeDestination } from "@/lib/home";

export default async function HomePage() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const request = new Request("http://localhost/", {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
  redirect(await homeDestination(request));
}
