# Teaching Tracker

The project was created to generate analyzes about student performance on Google Classroom using his API.

## How to use

For the initial setup is necessary to create an application on Cloud Platform across the button **Enable the Classroom API** on the page of API documentation https://developers.google.com/classroom/quickstart/nodejs and create the file `credentials.json`.

Then you must to run:
```bash
npm install
npm start
```

## Environment Variables

|Variable|Default|Example|Description|
|---|---|---|---|
| STUDENT | `undefined` | caleb | The student's name to build the data folder name, and to avoid the question |
| UPDATE | `false` | true | Force the data update from API| 
| BEGIN | `false` | 2020-10-01 | Begin date for reports| 
| UNTIL | `false` | 2020-11-26 | End date for reports| 

## Contributing

Help me to build.

## License

MIT.
