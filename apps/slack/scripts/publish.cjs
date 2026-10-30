// 승인·머지된 전용 workflow에서만 공개. 기존 열톡 latest 릴리스는 변경하지 않는다.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { execFileSync } = require("node:child_process")
const project = path.resolve(__dirname, ".."), dist = path.join(project, "dist")
const { version } = require("../package.json")
const repository = "timeofpassion/yeoltalk-desktop", tag = "passion-slack-updates"
const installer = `passion-slack-setup-${version}.exe`
const metadata = fs.readFileSync(path.join(dist, "latest.yml"), "utf8")
if (!/^\d+\.\d+\.\d+$/.test(version) || !metadata.includes(`version: ${version}\n`) || !metadata.includes(`path: ${installer}\n`)) throw new Error("설치파일/업데이트 버전이 다릅니다")
const digest = crypto.createHash("sha512").update(fs.readFileSync(path.join(dist, installer))).digest("base64")
if (!metadata.includes(`sha512: ${digest}`)) throw new Error("설치파일 무결성 정보가 다릅니다")
if (!process.argv.includes("--publish")) { console.log(`검증 완료: ${installer}. 공개하지 않았습니다.`); process.exit(0) }
if (process.env.GITHUB_ACTIONS !== "true") throw new Error("공개는 승인·머지된 GitHub workflow에서 실행하세요")
const gh = args => execFileSync("gh", [...args, "--repo", repository], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
let exists = false
try { gh(["release", "view", tag]); exists = true } catch {}
if (!exists) gh(["release", "create", tag, "--prerelease", "--title", "열정 슬랙 자동 업데이트", "--notes", "내부 슬랙 Windows 전용 설치파일. 기존 열톡 릴리스와 분리된 업데이트 경로입니다."])
else {
  const previous = path.join(dist, "previous-latest.yml")
  try {
    gh(["release", "download", tag, "--pattern", "latest.yml", "--output", previous, "--clobber"])
  } catch { throw new Error("이전 업데이트 버전을 확인하지 못해 공개를 중단했습니다") }
  const old = fs.readFileSync(previous, "utf8").match(/^version:\s*(\d+\.\d+\.\d+)/m)?.[1]
  if (!old) throw new Error("이전 버전 정보가 없습니다")
  const compare = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }
  if (compare(version, old) <= 0) throw new Error(`버전을 ${old}보다 높여야 합니다`)
}
// 실행파일/블록맵 먼저, 최신 안내 파일은 마지막에 바꿔 다운로드 중인 PC를 보호한다.
gh(["release", "upload", tag, path.join(dist, installer), path.join(dist, installer + ".blockmap"), "--clobber"])
gh(["release", "upload", tag, path.join(dist, "latest.yml"), "--clobber"])
console.log(`공개 완료: 열정 슬랙 ${version}`)
