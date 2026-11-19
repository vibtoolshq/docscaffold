import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
const root=process.cwd();
const files=execFileSync("git",["ls-files","--cached","-z"],{cwd:root,encoding:"utf8"}).split("\0").filter(Boolean);
const forbidden=["notes/", "project/", ".playwright-mcp/", "private-docs/", "config/private/"];
for(const f of files){
  if(forbidden.some(p=>f.startsWith(p))||/(?:^|\/)\.env(?:\.|$)/.test(f))throw new Error("Non-public path included: "+f);
  if(/\.(png|ico|jpg|jpeg|webp|gif)$/i.test(f))continue;
  const full=path.join(root,f);
  if(!fs.existsSync(full))continue;
  const content=fs.readFileSync(full,"utf8");
  if(/ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{15,}|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{15,}/.test(content))throw new Error("Potential secret in tracked path: "+f);
  if(f!=="scripts/check-public-release.mjs" && /github\.com\/(?:vibdocs|JILLU-Games)(?:\/|$)|5660\s+Kochakata|nurnobihossain|1795-470603/i.test(content))throw new Error("Source-specific or personal reference in tracked path: "+f);
}
const allow="https://github.com/vibtoolshq/docscaffold";
const registryFiles=["config/projects.json","config/presets/dev-portal/projects.json","config/presets/user-portal/projects.json"];
for(const f of registryFiles){
  const items=JSON.parse(fs.readFileSync(path.join(root,f),"utf8"));
  if(!Array.isArray(items))throw new Error("Registry must be array: "+f);
  for(const item of items){
    const repo=typeof item==="string"?item:item?.repoUrl;
    if(typeof repo!=="string"||repo.replace(/\.git$/,"")!==allow)throw new Error("Non-public/unapproved default repository in "+f);
    if(typeof item==="object"&&item!==null&&["localPath","secretKey","gitToken","gitTokenEnv","gitUsername"].some(k=>k in item))throw new Error("Private/local fields in "+f);
  }
}
console.log("Public release guard PASS: "+files.length+" tracked paths; only approved public default repositories.");
