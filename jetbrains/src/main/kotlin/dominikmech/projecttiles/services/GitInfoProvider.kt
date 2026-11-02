package dominikmech.projecttiles.services

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import dominikmech.projecttiles.domain.CommitInfo
import dominikmech.projecttiles.domain.GitInfo
import dominikmech.projecttiles.domain.SyncInfo
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.isRegularFile

private const val FIELD_SEPARATOR = '\u001f'
private const val LOG_FORMAT = "%h%x1f%s%x1f%cr%x1f%an"

/**
 * Hardening flags passed to every git invocation:
 *  - `--no-optional-locks` never takes the index lock, so we cannot collide with the IDE's own git;
 *  - `core.fsmonitor=false` ignores a repository-level fsmonitor hook a malicious repo config could use to run a program;
 *  - `core.hooksPath` pointed at an empty location disables repo hooks for our calls.
 */
private val BASE_ARGS = listOf("--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.quotepath=off")

/**
 * Reads git state with the `git` CLI. The branch comes straight from `.git/HEAD`, so a non-repo
 * costs one stat. Blocking: call from a background thread.
 */
class GitInfoProvider(private val fetchRemote: () -> Boolean, private val timeoutMs: Int = 5000, private val fetchTimeoutMs: Int = 20000) {
    fun fetchEnabled(): Boolean = fetchRemote()

    /** Local-only state (branch, last commit, ahead/behind against the last fetched upstream); null when not a repository. */
    fun quickInfo(folder: Path): GitInfo? {
        val head = readHead(folder) ?: return null
        val branch = head.branch ?: git(folder, "rev-parse", "--short", "HEAD")?.trim()?.ifEmpty { null } ?: "HEAD"
        val commit = git(folder, "log", "-1", "--format=$LOG_FORMAT")?.let(::parseCommitLine)
        return GitInfo(branch, commit, count(folder, fetched = false))
    }

    /** Runs `git fetch` and recounts ahead/behind. Slow (network). Null when the branch has no upstream. */
    fun fetchAndCount(folder: Path): SyncInfo? {
        val fetched = if (fetchEnabled()) git(folder, "fetch", "--quiet", "--no-tags", timeout = fetchTimeoutMs) != null else false
        return count(folder, fetched)
    }

    private fun count(folder: Path, fetched: Boolean): SyncInfo? {
        val upstream = git(folder, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")?.trim()?.ifEmpty { null } ?: return null
        val counts = parseAheadBehind(git(folder, "rev-list", "--left-right", "--count", "HEAD...@{upstream}") ?: "") ?: return null
        return SyncInfo(upstream, counts.first, counts.second, fetched)
    }

    private fun git(cwd: Path, vararg args: String, timeout: Int = timeoutMs): String? = try {
        val command = GeneralCommandLine(listOf("git") + BASE_ARGS + args)
            .withWorkingDirectory(cwd)
            .withCharset(StandardCharsets.UTF_8)
            .withEnvironment(mapOf("GIT_TERMINAL_PROMPT" to "0", "GIT_OPTIONAL_LOCKS" to "0"))
        val output = CapturingProcessHandler(command).runProcess(timeout)
        if (output.isTimeout || output.exitCode != 0) null else output.stdout
    } catch (_: Exception) {
        null
    }

    private class Head(val branch: String?)

    /** Reads `.git/HEAD`, following a `gitdir:` pointer for worktrees/submodules; null when not a repository. */
    private fun readHead(folder: Path): Head? = try {
        var gitDir = folder.resolve(".git")
        if (gitDir.isRegularFile()) {
            val pointer = Regex("^gitdir:\\s*(.+)$", RegexOption.MULTILINE).find(Files.readString(gitDir)) ?: return null
            gitDir = folder.resolve(pointer.groupValues[1].trim()).normalize()
        }
        val head = Files.readString(gitDir.resolve("HEAD")).trim()
        Head(Regex("^ref:\\s*refs/heads/(.+)$").find(head)?.groupValues?.get(1))
    } catch (_: Exception) {
        null
    }

    companion object {
        fun parseCommitLine(line: String): CommitInfo? {
            val parts = line.trim().split(FIELD_SEPARATOR)
            val hash = parts.getOrNull(0)?.ifEmpty { null } ?: return null
            return CommitInfo(hash, parts.getOrElse(1) { "" }, parts.getOrElse(2) { "" }, parts.getOrElse(3) { "" })
        }

        fun parseAheadBehind(output: String): Pair<Int, Int>? {
            val match = Regex("^(\\d+)\\s+(\\d+)$").find(output.trim()) ?: return null
            return match.groupValues[1].toInt() to match.groupValues[2].toInt()
        }
    }
}
