/* Router-level flows render the whole app; give async queries more time than the 1 s default. */
import { configure } from '@testing-library/react-native';

configure({ asyncUtilTimeout: 5000 });
