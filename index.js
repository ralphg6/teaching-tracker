const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const { exit } = require('process');
const { boolean } = require('boolean');

const {
  UPDATE = false,
  EXCLUDE_COURSES = '',
  BEGIN = false,
  UNTIL = false,
} = process.env;

let {
  STUDENT = undefined,
} = process.env;

const COURSES_PATH = 'courses.json';

const EXCLUDED_COURSES = EXCLUDE_COURSES.split(',');

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

function readJSON(path) {
  if (!fs.existsSync(`_data/${STUDENT}`)) {
    throw new Error('The STUDENT was not created yet!');
  }
  return fs.readFileSync(`_data/${STUDENT}/${path}`);
}

function writeJSON(path, json) {
  if (!fs.existsSync(`_data/${STUDENT}`)) {
    fs.mkdirSync(`_data/${STUDENT}`, { recursive: true });
  }
  fs.writeFileSync(`_data/${STUDENT}/${path}`, JSON.stringify(json, null, 1));
}

function existsJSON(path) {
  return fs.existsSync(`_data/${STUDENT}/${path}`);
}

function getUpdateDate(submission) {
  return submission.updateTime ? submission.updateTime.split('T')[0] : 'WITHOUT_DATE';
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
  });
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

// function printTasks(tasks) {
//   tasks.forEach((task) => {
//     console.log('task id: %s title: %s state: %s', task.id, task.title, task.state);
//   });
// }

// function printSubmissions(submissions) {
//   submissions.forEach((submission) => {
//     console.log(
//       'submission id: %s task id: %s date: %s state: %s',
//       submission.id,
//       submission.courseWorkId,
//       submission.updateTime,
//       submission.state,
//     );
//   });
// }

function analyzesPerDate(courses) {
  const analyzesPerDateData = {};
  courses.forEach((course) => {
    Object.keys(course.tasksAnalyze).forEach((state) => {
      Object.keys(course.tasksAnalyze[state]).forEach((date) => {
        if (!analyzesPerDateData[date]) analyzesPerDateData[date] = {};
        if (!analyzesPerDateData[date][state]) analyzesPerDateData[date][state] = [];
        analyzesPerDateData[date][state] = analyzesPerDateData[date][state]
          .concat(course.tasksAnalyze[state][date]);
      });
    });
  });

  const analyzesPerDateSummary = {};

  Object.keys(analyzesPerDateData).sort().reverse().forEach((date) => {
    analyzesPerDateSummary[date] = {};
    Object.keys(analyzesPerDateData[date]).forEach((state) => {
      analyzesPerDateSummary[date][state] = analyzesPerDateData[date][state].length;
    });
  });

  writeJSON('analyzesPerDateSummary.json', analyzesPerDateSummary);

  return analyzesPerDateData;
}

function analyzesPerState(courses) {
  const analyzesPerStateData = {};
  courses.forEach((course) => {
    Object.keys(course.tasksAnalyze).forEach((state) => {
      if (!analyzesPerStateData[state]) analyzesPerStateData[state] = {};
      Object.keys(course.tasksAnalyze[state]).forEach((date) => {
        if (!analyzesPerStateData[state][date]) analyzesPerStateData[state][date] = [];
        analyzesPerStateData[state][date] = analyzesPerStateData[state][date]
          .concat(course.tasksAnalyze[state][date]);
      });
    });
  });

  const analyzesPerStateSummary = {};

  Object.keys(analyzesPerStateData).sort().reverse().forEach((state) => {
    analyzesPerStateSummary[state] = { total: 0, dates: {} };
    Object.keys(analyzesPerStateData[state]).forEach((date) => {
      analyzesPerStateSummary[state].total += analyzesPerStateData[state][date].length;
      analyzesPerStateSummary[state].dates[date] = analyzesPerStateData[state][date].length;
    });
  });

  writeJSON('analyzesPerStateSummary.json', analyzesPerStateSummary);

  return analyzesPerStateData;
}

const isExcludedCourse = (id) => EXCLUDED_COURSES.includes(id);

const isIncludedSubmission = (submission) => {
  const updateDate = getUpdateDate(submission);
  if (BEGIN && updateDate !== 'WITHOUT_DATE' && updateDate < BEGIN) return false;
  if (UNTIL && updateDate !== 'WITHOUT_DATE' && updateDate > UNTIL) return false;
  return true;
};

async function analyzeTasks(course) {
  const tasksAnalyze = {};

  course.tasks.forEach((task) => {
    if (task.submissions.length !== 1) {
      throw new Error(`Wrong number of submissions for task ${task.id}: ${task.submissions.length}`);
    }
    const submission = task.submissions[0];
    // console.log("task", task);

    if (isIncludedSubmission(submission)) {
      const updateDate = getUpdateDate(submission);

      if (!tasksAnalyze[submission.state]) tasksAnalyze[submission.state] = {};
      if (!tasksAnalyze[submission.state][updateDate]) {
        tasksAnalyze[submission.state][updateDate] = [];
      }

      tasksAnalyze[submission.state][updateDate].push(task);
    }
  });

  // console.log("tasksAnalyze", tasksAnalyze);

  // eslint-disable-next-line no-param-reassign
  course.tasksAnalyze = tasksAnalyze;
}

async function setupStudent() {
  if (!STUDENT) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    STUDENT = await new Promise((resolve) => {
      rl.question('What is student name? ', (name) => {
        rl.close();
        resolve(name);
      });
    });

    if (!STUDENT || !STUDENT.length) {
      console.error('The student is undefined! (Define STUDENT as env)');
      exit();
    }
  }
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
async function getAuth(c) {
  const {
    client_secret: clientSecret,
    client_id: clientId,
    redirect_uris: redirectUris,
  } = c.installed;
  const oAuth2Client = new google.auth.OAuth2(
    clientId, clientSecret, redirectUris[0],
  );

  let token;
  try {
    token = readJSON(TOKEN_PATH);
  } catch (e) {
    return getNewToken(oAuth2Client);
  }

  oAuth2Client.setCredentials(JSON.parse(token));
  return oAuth2Client;
}

async function getClassroomClient() {
  const auth = await getAuth(credentials);
  const classroom = google.classroom({ version: 'v1', auth });
  return classroom;
}

async function listSubmissions(courseId, pageToken) {
  let resultList = [];
  const classroom = await getClassroomClient();
  // console.log('courseId', courseId);
  try {
    const result = (await classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId: '-', pageToken })).data;
    const submissions = result.studentSubmissions;
    // printSubmissions(submissions);

    if (submissions) resultList = resultList.concat(submissions);

    if (result.nextPageToken) {
      resultList = resultList.concat(await listSubmissions(courseId, result.nextPageToken));
    }

    return resultList;
  } catch (e) {
    console.error('Can not list submissions', e);
    throw e;
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

    if (tasks) resultList = resultList.concat(tasks);

    if (result.nextPageToken) {
      resultList = resultList.concat(await listTasks(courseId, result.nextPageToken));
    }

    return resultList;
  } catch (e) {
    console.error('Can not list tasks', e);
    throw e;
  }
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

    const courses = result.courses.filter((c) => !isExcludedCourse(c.id));

    if (courses) resultList = resultList.concat(courses);

    if (result.nextPageToken) {
      resultList = resultList.concat(await listCourses(result.nextPageToken));
    }

    return resultList;
  } catch (e) {
    console.error('Can not list courses', e);
    throw e;
  }
}

async function fetchTasks(course) {
  if (isExcludedCourse(course.id)) return;
  // courseMap[course.id] = course;
  // console.log("course", course);
  const tasks = await listTasks(course.id);
  const tasksMap = {};
  // console.log("tasks", tasks);
  tasks.forEach((task) => {
    tasksMap[task.id] = task;
    // eslint-disable-next-line no-param-reassign
    task.submissions = [];
  });
  const submissions = await listSubmissions(course.id);
  submissions.forEach((submission) => {
    tasksMap[submission.courseWorkId].submissions.push(submission);
  });
  // eslint-disable-next-line no-param-reassign
  course.tasks = tasks;
}

async function fetchCourses() {
  if (boolean(UPDATE) || !existsJSON(COURSES_PATH)) {
    try {
      console.log('Fecth Courses in ONLINE mode');

      const courses = (await listCourses()).filter((c) => !isExcludedCourse(c.id));

      await Promise.all(courses.map((course) => fetchTasks(course)));

      writeJSON(COURSES_PATH, courses);

      return courses;
    } catch (e) {
      console.error('erro in init', e);
      throw e;
    }
  } else {
    console.log('Fecth Courses in OFFLINE mode');
    const content = readJSON(COURSES_PATH);
    return JSON.parse(content);
  }
}

const init = async () => {
  await setupStudent();

  const courses = (await fetchCourses()).filter((c) => !isExcludedCourse(c.id));

  await Promise.all(courses.map((course) => analyzeTasks(course)));

  printCourses(courses);

  // const today = new Date().

  writeJSON('analyzesPerState.json', analyzesPerState(courses));

  const analyzesPerDateData = analyzesPerDate(courses);

  writeJSON('analyzesPerDate.json', analyzesPerDateData);
};

init();
