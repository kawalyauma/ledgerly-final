package com.ledgerly.scanner.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import coil3.ImageLoader
import coil3.compose.setSingletonImageLoaderFactory
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.ledgerly.scanner.Api
import com.ledgerly.scanner.UploadWorker

val LocalNav = staticCompositionLocalOf<NavHostController> { error("no nav") }
/** The signed-in user's day (/learn/me), shared by every screen. */
val LocalMe = staticCompositionLocalOf<Loaded> { error("no me") }

private data class Tab(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)
private val tabs = listOf(
    Tab("home", "Home", Icons.Filled.Home), Tab("lessons", "Lessons", Icons.Filled.MenuBook), Tab("scan", "Scan", Icons.Filled.DocumentScanner),
    Tab("bank", "Bank", Icons.Filled.Quiz), Tab("learners", "Learners", Icons.Filled.Groups),
)

@Composable
fun AcademicsApp() {
    val ctx = LocalContext.current
    val api = remember { Api(ctx) }
    var signedIn by remember { mutableStateOf(api.signedIn) }
    setSingletonImageLoaderFactory { c -> ImageLoader.Builder(c).components { add(OkHttpNetworkFetcherFactory(callFactory = { api.imageClient })) }.build() }
    CompositionLocalProvider(LocalApi provides api) {
        AcademicsTheme {
            if (!signedIn) LoginScreen { signedIn = true; UploadWorker.kick(ctx) }
            else Shell(onSignOut = { api.logout(); Cache.clear(ctx); signedIn = false })
        }
    }
}

@Composable
private fun Shell(onSignOut: () -> Unit) {
    val nav = rememberNavController()
    val me = rememberData("/api/v1/learn/me")
    val current = nav.currentBackStackEntryAsState().value?.destination?.route
    CompositionLocalProvider(LocalNav provides nav, LocalMe provides me) {
        Scaffold(
            containerColor = C.Bg,
            bottomBar = {
                if (tabs.any { it.route == current }) NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
                    tabs.forEach { t ->
                        NavigationBarItem(
                            selected = current == t.route,
                            onClick = { nav.navigate(t.route) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true } },
                            icon = { Icon(t.icon, t.label) }, label = { Text(t.label) },
                            colors = NavigationBarItemDefaults.colors(selectedIconColor = C.Brand, selectedTextColor = C.Brand, indicatorColor = C.BrandSoft,
                                unselectedIconColor = C.Muted, unselectedTextColor = C.Muted),
                        )
                    }
                }
            },
        ) { pad ->
            NavHost(nav, startDestination = "home", modifier = Modifier.padding(bottom = pad.calculateBottomPadding())) {
                composable("home") { HomeScreen() }
                composable("lessons") { LessonsScreen() }
                composable("scan") { ScanScreen() }
                composable("bank") { BankScreen() }
                composable("learners") { LearnersScreen() }
                composable("profile") { ProfileScreen(onSignOut) }
                composable("search") { SearchScreen() }
                composable("timetable") { TimetableScreen() }
                composable("coverage") { CoverageScreen() }
                composable("engine") { EngineScreen() }
                composable("ai?q={q}", listOf(navArgument("q") { type = NavType.StringType; nullable = true })) { AiScreen(it.arguments?.getString("q")) }
                composable("newscheme") { NewSchemeScreen() }
                composable("scheme/{id}") { SchemeScreen(it.arguments!!.getString("id")!!) }
                composable("lesson/{id}?plan={plan}", listOf(navArgument("plan") { type = NavType.StringType; nullable = true })) {
                    LessonScreen(it.arguments!!.getString("id")!!, it.arguments?.getString("plan"))
                }
                composable("newbatch") { NewBatchScreen() }
                composable("batch/{id}") { BatchScreen(it.arguments!!.getString("id")!!) }
                composable("question/{id}") { QuestionScreen(it.arguments!!.getString("id")!!) }
                composable("practice") { PracticeScreen() }
                composable("figures") { FiguresScreen() }
                composable("figure/{id}") { FigureScreen(it.arguments!!.getString("id")!!) }
                composable("learner/{id}") { LearnerScreen(it.arguments!!.getString("id")!!) }
            }
        }
    }
}
