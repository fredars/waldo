import { Flex, Box } from '@chakra-ui/react';
import Sidebar from '@components/dashboard/Sidebar';
export default function User() {
  return (
    <div>
      <Flex direction={'row'}>
        <Sidebar />
      </Flex>
    </div>
  );
}
