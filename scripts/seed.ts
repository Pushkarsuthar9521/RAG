import { ingestDocument } from '../src/lib/ingest';

const sampleContent = `
# Understanding React Hooks

React Hooks allow you to use state and other React features without writing a class. 

## useState
The useState hook lets you add state to functional components. It returns an array with two values: the current state and a function to update it.

## useEffect
The useEffect hook lets you perform side effects in function components. Data fetching, setting up a subscription, and manually changing the DOM in React components are all examples of side effects. It runs after the first render and after every update.
`;

async function main() {
  console.log('Seeding database with sample document...');
  // Dummy entity ID for testing (matches a UUID format)
  const dummyEntityId = '00000000-0000-0000-0000-000000000000';
  
  try {
    const docId = await ingestDocument(dummyEntityId, 'React Hooks Guide', sampleContent);
    console.log('Successfully ingested document with ID:', docId);
    console.log('You can now start the app and ask about React Hooks!');
  } catch (error) {
    console.error('Failed to ingest document:', error);
  }
}

main();
