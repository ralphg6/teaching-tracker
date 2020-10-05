const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const { exit } = require('process');

// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.topics.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    'https://www.googleapis.com/auth/classroom.rosters.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

let credentialsContent;
// Load client secrets from a local file.
try {
    credentialsContent = fs.readFileSync('credentials.json');

} catch (e) {
    console.error('Error loading client secret file:', e);
    throw e;
}

if (!credentialsContent) {
    console.error('The credentials could not be obtained.');
    exit();
}

const credentials = JSON.parse(credentialsContent);

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
async function getAuth(credentials) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    let token;
    try {
        token = readJSON(TOKEN_PATH);
    } catch (e) {
        return getNewToken(oAuth2Client);
    }

    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;

}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve, reject) => {
        rl.question('Enter the code from that page here: ', (code) => {
            rl.close();
            oAuth2Client.getToken(code, (err, token) => {
                if (err) {
                    console.error('Error retrieving access token', err);
                    reject(err);
                }
                oAuth2Client.setCredentials(token);
                // Store the token to disk for later program executions
                writeJSON(TOKEN_PATH, token);
                resolve(oAuth2Client);
            });
        });
    })

}

async function getClassroomClient() {
    const auth = await getAuth(credentials);
    const classroom = google.classroom({ version: 'v1', auth });
    return classroom;
}

/**
 * Lists the first 10 courses the user has access to.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listCourses(pageToken) {
    const classroom = await getClassroomClient();
    let resultList = [];

    try {
        const result = (await classroom.courses.list({
            pageSize: 10,
            pageToken,
        })).data;

        const courses = result.courses;

        if (courses)
            resultList = resultList.concat(courses);

        if (result.nextPageToken) {
            resultList = resultList.concat(await listCourses(result.nextPageToken));
        }

        return resultList;

    } catch (e) {
        console.error('Can not list courses', e);
        throw e;
    }

}

function printCourses(courses) {
    if (courses && courses.length) {
        console.log('Courses:');
        courses.forEach((course) => {
            console.log(`${course.name} (${course.id})`);
        });
    } else {
        console.log('No courses found.');
    }
}

async function listTasks(courseId, pageToken) {
    const classroom = await getClassroomClient();

    let resultList = [];

    // console.log('courseId', courseId);
    try {
        const result = (await classroom.courses.courseWork.list({ courseId, pageToken })).data;
        const tasks = result.courseWork;
        // printTasks(tasks);

        if (tasks)
            resultList = resultList.concat(tasks);

        if (result.nextPageToken) {
            resultList = resultList.concat(await listTasks(courseId, result.nextPageToken));
        }

        return resultList;

    } catch (e) {
        console.error('Can not list tasks', e);
        throw e;
    }
}

function printTasks(tasks) {
    tasks.forEach((task) => {
        console.log('task id: %s title: %s state: %s', task.id, task.title, task.state);
    });
}

async function listSubmissions(courseId, pageToken) {

    let resultList = [];
    const classroom = await getClassroomClient();
    // console.log('courseId', courseId);
    try {
        const result = (await classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId: '-', pageToken })).data;
        const submissions = result.studentSubmissions;
        // printSubmissions(submissions);

        if (submissions)
            resultList = resultList.concat(submissions);

        if (result.nextPageToken) {
            resultList = resultList.concat(await listSubmissions(courseId, result.nextPageToken));
        }

        return resultList;

    } catch (e) {
        console.error('Can not list submissions', e);
        throw e;
    }
}

function writeJSON(path, json) {
    if (!fs.existsSync(`_data/${STUDENT}`)){
        fs.mkdirSync(`_data/${STUDENT}`, {recursive: true});
    }
    fs.writeFileSync(`_data/${STUDENT}/${path}`, JSON.stringify(json, null, 1));
}

function readJSON(path) {
    if (!fs.existsSync(`_data/${STUDENT}`)){
        throw new Error("The STUDENT was not created yet!");
    }
    return fs.readFileSync(`_data/${STUDENT}/${path}`);
}

function existsJSON(path) {
    return fs.existsSync(`_data/${STUDENT}/${path}`);
}


async function fetchCourses() {

    if (FORCE_UPDATE || !IS_OFFLINE || !existsJSON(COURSES_PATH)) {
        try {
            console.log("Fecth Courses in ONLINE mode");

            const courseMap = {};
            const courses = await listCourses();
            for (const course of courses) {
                courseMap[course.id] = course;
                // console.log("course", course);
                const tasks = await listTasks(course.id);
                const tasksMap = {};
                // console.log("tasks", tasks);
                tasks.forEach(task => {
                    tasksMap[task.id] = task;
                    task.submissions = [];
                });
                const submissions = await listSubmissions(course.id);
                submissions.forEach(submission => {
                    tasksMap[submission.courseWorkId].submissions.push(submission);
                });
                course.tasks = tasks;
            }

            // console.log("courseMap", courseMap);

            writeJSON(COURSES_PATH, courses);

            return courses;
        } catch (e) {
            console.error('erro in init', e);
            throw e;
        }
    } else {
        console.log("Fecth Courses in OFFLINE mode");
        const content = readJSON(COURSES_PATH);
        return JSON.parse(content);
    }

}

function printSubmissions(submissions) {
    submissions.forEach((submission) => {
        console.log('submission id: %s task id: %s date: %s state: %s', submission.id, submission.courseWorkId, submission.updateTime, submission.state);
    });
}

async function analizeTasks(course) {
    const tasksAnalize = {};

    course.tasks.forEach(task => {
        if (task.submissions.length !== 1) {
            throw new Error(`Wrong number of submissions for task ${task.id}: ${task.submissions.length}`);
        }
        const submission = task.submissions[0];
        // console.log("task", task);

        const updateDate = submission.updateTime ? submission.updateTime.split('T')[0] : "WITHOUT_DATE";

        if (!tasksAnalize[submission.state]) tasksAnalize[submission.state] = {};
        if (!tasksAnalize[submission.state][updateDate]) tasksAnalize[submission.state][updateDate] = [];

        tasksAnalize[submission.state][updateDate].push(task);
    });

    // console.log("tasksAnalize", tasksAnalize);

    course.tasksAnalize = tasksAnalize;
}

const {
    IS_OFFLINE = true,
    FORCE_UPDATE = false,
    STUDENT='default',
} = process.env;

const COURSES_PATH = "courses.json";

if (STUDENT === 'default') {
    console.error('The student is undefined! (Define STUDENT as env)')
    exit();
}


function analizesPerDate(courses) {
    const analizesPerDate = {};
    for (const course of courses) {
        for (const state in course.tasksAnalize) {
            for (const date in course.tasksAnalize[state]) {
                if (!analizesPerDate[date])
                    analizesPerDate[date] = {};
                if (!analizesPerDate[date][state])
                    analizesPerDate[date][state] = [];
                analizesPerDate[date][state] = analizesPerDate[date][state].concat(course.tasksAnalize[state][date]);
            }
        }
    }

    const analizesPerDateSummary = {};

    Object.keys(analizesPerDate).sort().reverse().map(date => {
        analizesPerDateSummary[date] = {};
        Object.keys(analizesPerDate[date]).map(state => {
            analizesPerDateSummary[date][state] = analizesPerDate[date][state].length;
        });
    });

    writeJSON('analizesPerDateSummary.json', analizesPerDateSummary);

    return analizesPerDate;
}

function analizesPerState(courses) {
    const analizesPerState = {};
    for (const course of courses) {
        for (const state in course.tasksAnalize) {
            if (!analizesPerState[state])
                analizesPerState[state] = {};
            for (const date in course.tasksAnalize[state]) {
                if (!analizesPerState[state][date])
                    analizesPerState[state][date] = [];
                analizesPerState[state][date] = analizesPerState[state][date].concat(course.tasksAnalize[state][date]);
            }
        }
    }

    const analizesPerStateSummary = {};

    Object.keys(analizesPerState).sort().reverse().map(state => {
        analizesPerStateSummary[state] = { total: 0, dates: {}};
        Object.keys(analizesPerState[state]).map(date => {
            analizesPerStateSummary[state].total += analizesPerState[state][date].length;
            analizesPerStateSummary[state].dates[date] = analizesPerState[state][date].length;
        });
    });

    writeJSON('analizesPerStateSummary.json', analizesPerStateSummary);

    return analizesPerState;
}

const init = async () => {

    const courses = await fetchCourses();

    for (const course of courses) {
        await analizeTasks(course);
    }

    printCourses(courses);

    writeJSON('analizesPerState.json', analizesPerState(courses));

    writeJSON('analizesPerDate.json', analizesPerDate(courses));

}


init();